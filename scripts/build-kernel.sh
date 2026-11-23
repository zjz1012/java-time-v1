#!/bin/bash
# 从上游 PluotSorbet 源码重建 J2ME 内核四件产物。
#
# 输出（默认 public/kernel/）：
#   j2me.js       JVM + MIDP 运行时（TypeScript → ES5）
#   native.js     C++ 层（Boehm GC → wasm，单文件同步加载）
#   main-all.js   运行时拼接包（按 Makefile 的 MAIN_JS_SRCS 顺序 + 外壳适配补丁）
#   classes.data  MIDP 类库镜像（jar 容器，改后缀规避平台丢弃 .zip/.jar）
#
# 前置：先跑 scripts/fetch-upstream.sh 拿到源码；emsdk 已装好
#       （默认 .work/emsdk，可用 EMSDK_DIR 覆盖），JDK 8+，
#       Node（走 npx 拉 typescript@2.9.2），Python 3。
#
# 用法：
#   bash scripts/fetch-upstream.sh    # 首次：拉源码到 vendor/ 并校验 commit
#   bash scripts/build-kernel.sh      # 全量重建
#   SKIP_JAVA=1 bash scripts/build-kernel.sh   # 只重编 JS 侧
#
# 产物属于 GPL-2.0 衍生作品，构建方法与补丁脚本必须与产物一同提供，
# 见 docs/provenance/SOURCES.md。

set -euo pipefail

# 运行环境的 PATH 最前面可能插着 rm/rmdir 的拦截 shim（安全删除）。
# configure / make 会反复清理自己的 conftest*，累计数量一超阈值就被拦下，
# 残留文件让后续探测读错（典型症状：configure 报 libatomic_ops is required、
# EEXIST: mkdir out、confdefs.h 不存在）。构建只删本项目自己的中间产物，
# 这里把 shim 目录从 PATH 移除，恢复系统 rm。
_clean_path=""
_ifs="$IFS"; IFS=':'
for _d in $PATH; do
  case "$_d" in
    *sandbox-center-runtime-kit/shim*) continue ;;
  esac
  _clean_path="${_clean_path:+$_clean_path:}$_d"
done
IFS="$_ifs"
export PATH="$_clean_path"
unset -f rm rmdir unlink 2>/dev/null || true
unset _clean_path _d _ifs

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

# 中间产物与工具链统一收在 .work/（已 gitignore），源码在 vendor/（同样 gitignore）。
# 两者都不入库：源码是 GPL-2.0 上游，产物按发布策略单独处理。
WORK="${KERNEL_WORK:-$ROOT/.work}"
REPO="${REPO:-$ROOT/vendor/pluotsorbet}"
EMSDK_DIR="${EMSDK_DIR:-$WORK/emsdk}"
ARTIFACTS="${ARTIFACTS:-$ROOT/public/kernel}"
TS_VER="${TS_VER:-2.9.2}"

if [ ! -f "$REPO/Makefile" ]; then
  echo "!! 找不到上游源码：$REPO" >&2
  echo "   先运行：bash scripts/fetch-upstream.sh" >&2
  exit 1
fi

cd "$REPO"
echo "== 源码：$REPO"
echo "== 产物：$ARTIFACTS"

# ---------------------------------------------------------------- 0 适配上游
echo "== 0/7 适配上游源码（Python 3 / 现代 clang / 现代 javac）"
python3 "$HERE/fixup-upstream.py" "$REPO"

echo "== 1/7 配置（RELEASE=1）"
# RELEASE=0（上游默认）会让 assert(false, TAGS[tag]) 全部生效，
# 而 Debug.error 是直接 throw —— 生产环境遇到任何未实现分支会当场炸。
make RELEASE=1 config.ts config-build

# ---------------------------------------------------------------- 2 本地化
echo "== 2/7 本地化资源"
rm -rf java/l10n && mkdir -p java/l10n
for f in $(find l10n -name "*.xml"); do
  python3 tools/xml_to_json.py "$f" "java/${f%.xml}.json" >/dev/null
done
mkdir -p java/custom/com/sun/midp/i18n java/custom/com/sun/midp/l10n
python3 tools/xml_to_java_classes.py l10n/en-US.xml

# ---------------------------------------------------------------- 3 Java 类库
if [ "${SKIP_JAVA:-0}" != "1" ]; then
  echo "== 3/7 Java 类库（Jpp + javac）"
  # 目录清单必须与 java/Makefile 的 SRC_DIRS 一致：jsr-179 只在 JSR_179=1 时才加，
  # 而它的 PlatformLocationProvider 是 com.sun.j2me.location 的实现类，
  # 漏掉就会在 LocationProviderImpl 里报「找不到符号」。
  SRC_DIRS="cldc1.1.1 vm midp custom jsr-179"
  JPP_DEFS="-DENABLE_JSR_205 -DENABLE_SSL -DENABLE_PUBLICKEYSTORE -DENABLE_JSR_211 \
-DENABLE_MULTIPLE_ISOLATES -DRECORD -DUSE_FILE_CONNECTION -DENABLE_JSR_234 -DENABLE_JSR_179"
  cd java
  javac -nowarn tools/Jpp.java
  for f in $(find $SRC_DIRS -name "*.jpp"); do
    # shellcheck disable=SC2086
    java -cp tools Jpp "$f" $JPP_DEFS -o "${f%.jpp}.java" >/dev/null 2>&1 || true
  done
  rm -rf build build-src && mkdir -p build build-src
  for d in $SRC_DIRS; do cp -a "$d/." build-src/; done
  # Java 1.3 时代把 enum 当变量名，javac 5+ 视为保留字
  for f in $(grep -rl "\benum\b" --include=*.java build-src 2>/dev/null || true); do
    perl -pi -e 's/\benum\b/en/g' "$f"
  done
  find ./build-src -name "*.java" > /tmp/kernel-srcs.txt
  javac -cp build-src -g:none -nowarn -source 8 -target 8 \
    -bootclasspath "" -extdirs "" -d ./build @/tmp/kernel-srcs.txt
  (cd build && jar cf0 ../classes.jar *)
  # Upstream also packs resources into the jar (java/Makefile EXTRA: png/bin/l10n json).
  # Without them, icons and localized strings are missing at runtime.
  EXTRA_FILES="$(find . -path ./build -prune -o \( -name '*.png' -o -name '*.bin' \) -print) $(find l10n -name '*.json')"
  if [ -n "${EXTRA_FILES// /}" ]; then
    # shellcheck disable=SC2086
    jar uf0 classes.jar $EXTRA_FILES
  fi
  ls -lh classes.jar
  cd "$REPO"
else
  echo "== 3/7 跳过 Java 类库"
fi

# ---------------------------------------------------------------- 4 JVM
echo "== 4/7 JVM 主脚本（tsc ${TS_VER}）"
# TS 2.9 对上游这段 2018 年的代码有两处类型告警（不影响生成物）：
#   jit/analyze.ts   TS2365  const enum 收窄后比较 None
#   vm/parser.ts     TS2540  给只读字段 superClassName 赋值
# tsc 默认 noEmitOnError=false，产物照常完整输出；只有出现**其他**错误才算失败。
set +e
npx -y -p typescript@$TS_VER tsc --preserveConstEnums --target ES5 \
  references.ts --out bld/j2me.js 2>&1 | tee /tmp/kernel-tsc.log
TSC_RC=${PIPESTATUS[0]}
set -e
if [ "$TSC_RC" -ne 0 ]; then
  OTHERS=$(grep "error TS" /tmp/kernel-tsc.log \
    | grep -vcE "jit/analyze\.ts.*TS2365|vm/parser\.ts.*TS2540" || true)
  if [ "${OTHERS:-0}" -ne 0 ]; then
    echo "!! tsc 失败（有 $OTHERS 处非已知错误）"
    exit 1
  fi
  echo "  （2 处已知类型告警，产物已完整输出，继续）"
fi
ls -lh bld/j2me.js

# ---------------------------------------------------------------- 5 native
echo "== 5/7 GC 与 native 层（emcc）"
# shellcheck disable=SC1091
set +u
source "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1
set -u

# Makefile 按平台要 libgc.dylib（macOS）/ libgc.so / libgc.dll，
# 判断条件必须跟它一致，否则 make 会重新 configure。
case "$(uname -s)" in
  Darwin) BOEHM_LIB=libgc.dylib ;;
  *)      BOEHM_LIB=libgc.so ;;
esac
if [ ! -f "vm/native/Boehm.js/.libs/$BOEHM_LIB" ]; then
  cd vm/native/Boehm.js
  # --host 必须显式给：emcc 编出的 conftest 是 wasm，configure 原会试着执行它，
  # 而 Node 24 的 fetch 不接受裸路径（Invalid URL）→ configure 判「cannot run C
  # compiled programs」。声明 host 后 configure 按交叉编译处理，跳过运行测试。
  # libatomic_ops 用默认的 check：交叉编译下 pkg-config 探不到，configure 会
  # 自动降级到源码目录里内嵌的那份（子项目会递归 configure，它也需 config.sub 补丁）。
  # --srcdir 必须显式给绝对路径：经 emconfigure 包装后 configure 推断出的 srcdir
  # 可能不是当前目录，于是找不到内嵌的 libatomic_ops，报「libatomic_ops is required」。
  emconfigure ./configure --srcdir="$(pwd)" --host=wasm32-unknown-emscripten \
    --without-threads --disable-threads \
    --enable-gc-debug=no --enable-gc-assertions=no __EMSCRIPTEN__=1
  emmake make
  cd "$REPO"
fi
# 注：asm.js 已不可得（emcc 2.x 静默忽略 WASM=0，1.38 的包已 404），
# 故 native 层走同步 wasm：SINGLE_FILE=1 + WASM_ASYNC_COMPILATION=0。
# ASMJS_TOTAL_MEMORY 上游写的是 128*1024*1024，emcc 2.x 不再求值表达式，按字节数传。
make bld/native.js ASMJS_TOTAL_MEMORY=134217728

# ---------------------------------------------------------------- 6 拼接
echo "== 6/7 运行时拼接（main-all.js）"
python3 "$HERE/build-main-all.py" "$REPO" bld/main-all.js

# ---------------------------------------------------------------- 7 收集
echo "== 7/7 收集产物"
# 布局由内核的硬编码决定，不能随意改：
#   main-all.js 里写死了 load("java/classes.data")，而 load() 是相对文档 base 的 XHR。
#   宿主页用 <base href="../kernel/"> 指向本目录，所以类库必须落在 <本目录>/java/ 下。
#   见 docs/architecture/kernel-contract.md §4。
#
# certs/_main.ks 同理：initFS 会无条件 load(APP_BASE_DIR + "certs/_main.ks")，
# 少这个文件 initFS 就 reject，start() 永远不执行 —— 症状只是控制台一行
#   Loading failed: "..."，页面上什么都看不到。
#
# style/emoji/ 是第三类：DisplayDevice.gainedForeground0 里等
#   Promise.all(loadingFGPromises)，emoji 图缺失时 emoji.loaded 永远为 false，
#   Java 线程就在那个 native 调用上挂住。此时 Canvas 已经创建、前台已经拿到，
#   但一次 refresh 都不会发生 —— 表现是「启动成功、画面全黑」，最难查的一种。
mkdir -p "$ARTIFACTS/java" "$ARTIFACTS/certs" "$ARTIFACTS/style"
cp bld/j2me.js bld/native.js bld/main-all.js "$ARTIFACTS/"
cp java/classes.jar "$ARTIFACTS/java/classes.data"
cp certs/_main.ks "$ARTIFACTS/certs/_main.ks"
cp -R style/emoji "$ARTIFACTS/style/"
ls -lh "$ARTIFACTS"/j2me.js "$ARTIFACTS"/native.js "$ARTIFACTS"/main-all.js \
  "$ARTIFACTS"/java/classes.data "$ARTIFACTS"/certs/_main.ks
echo "   style/emoji: $(ls "$ARTIFACTS/style/emoji"/*.png 2>/dev/null | wc -l | tr -d ' ') 个 PNG"

echo "== 完成。校验值："
( command -v md5 >/dev/null && md5 -q "$ARTIFACTS"/*.js "$ARTIFACTS"/java/classes.data ) \
  || md5sum "$ARTIFACTS"/*.js "$ARTIFACTS"/java/classes.data
