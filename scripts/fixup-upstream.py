#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把一份干净的上游 PluotSorbet 改成「能在 2018 年之后的工具链上编译」的状态。

上游最后活跃在 2018 年，工具链假设是：Python 2.7、JDK 5/6、Emscripten 当年版本。
本机是 Python 3 / JDK 17 / emsdk 2.0.34，必须补三类东西：

  1. tools/preprocess-1.1.0/lib/preprocess.py —— Python 2 语法（except X, e / 0777 /
     has_key / types.StringType），Python 3 直接 ImportError。
  2. vm/native/Boehm.js —— `void GC_noop();` 是 K&R 空参数声明，现代 clang 视为
     `(void)` 无参数原型；调用点传了参数，emcc 编译出的 wasm 在运行时 trap
     （unreachable）。两侧统一改成可变参数形式。
  3. java/custom/java/lang/StringBuilder.java —— 上游 CLDC 类库只有 StringBuffer，
     现代 javac 的字符串拼接生成 StringBuilder，缺类则类库编译失败。

全部变换都是**幂等**的：重复执行不会二次修改，已改过就跳过。

用法：
    python3 fixup-upstream.py <pluotsorbet 目录>
"""
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------- 替换规则表
# (相对路径, 原文, 替换文, 说明)
PREPROCESS_RULES = [
    ('tools/preprocess-1.1.0/lib/preprocess.py',
     'if type(streamOrFileName) == types.StringType:',
     'if type(streamOrFileName) == str:',
     'py3: types.StringType 已移除'),
    ('tools/preprocess-1.1.0/lib/preprocess.py',
     '    except Exception, ex:',
     '    except Exception as ex:',
     'py3: except 语法'),
    ('tools/preprocess-1.1.0/lib/preprocess.py',
     '    if type(outfile) in types.StringTypes:',
     '    if isinstance(outfile, str):',
     'py3: types.StringTypes 已移除'),
    ('tools/preprocess-1.1.0/lib/preprocess.py',
     '            os.chmod(outfile, 0777)',
     '            os.chmod(outfile, 0o777)',
     'py3: 0777 八进制字面量非法'),
    ('tools/preprocess-1.1.0/lib/preprocess.py',
     'if not contentType and self.filenameMap.has_key(basename):',
     'if not contentType and basename in self.filenameMap:',
     'py3: dict.has_key 已移除'),
    ('tools/preprocess-1.1.0/lib/preprocess.py',
     '            if self.suffixMap.has_key(suffix):',
     '            if suffix in self.suffixMap:',
     'py3: dict.has_key 已移除'),
    ('tools/preprocess-1.1.0/lib/preprocess.py',
     '        if content.startswith("<?xml"):  # cheap XML sniffing',
     '        if content.startswith(b"<?xml"):  # cheap XML sniffing',
     'py3: bytes.startswith 不接受 str'),
    ('tools/preprocess-1.1.0/lib/preprocess.py',
     '    except getopt.GetoptError, msg:',
     '    except getopt.GetoptError as msg:',
     'py3: except 语法'),
    ('tools/preprocess-1.1.0/lib/preprocess.py',
     '    except PreprocessError, ex:',
     '    except PreprocessError as ex:',
     'py3: except 语法'),
]

# Boehm 的两处必须同时改，只改一侧会变成签名冲突（wasm unreachable trap）
CONFIG_SUB_NEW = (
    "timestamp='2013-10-01'\n"
    "\n"
    "# Local patch: accept the emscripten triple so configure switches to\n"
    "# cross-compiling mode and stops trying to execute wasm binaries.\n"
    'case "$1" in\n'
    '  wasm32-unknown-emscripten) echo "wasm32-unknown-emscripten"; exit 0 ;;\n'
    'esac\n'
)

BOEHM_RULES = [
    ('vm/native/Boehm.js/include/private/gc_priv.h',
     '    void GC_noop();\n',
     '    void GC_noop(void*, ...);\n',
     'K&R 空参数原型 → 可变参数'),
    ('vm/native/Boehm.js/mark.c',
     '    void GC_noop() {}\n',
     '    void GC_noop(void *p, ...) {}\n',
     '定义与原型对齐'),
    # configure 必须知道自己在交叉编译，否则会执行 emcc 产出的 wasm conftest；
    # Node 24 的 fetch 不接受裸路径（ERR_INVALID_URL）→ 判成「cannot run C
    # compiled programs」。2013 版 config.sub 不认 emscripten 三元组，
    # 在解析入口前直接放行，让 host != build 成立。
    # libatomic_ops 是内嵌子项目，configure 会递归进去，它自己那份 config.sub
    # 同样要补，否则主 configure 过了、子 configure 又炸。
    ('vm/native/Boehm.js/config.sub',
     "timestamp='2013-10-01'\n", CONFIG_SUB_NEW, '交叉编译识别'),
    ('vm/native/Boehm.js/libatomic_ops/config.sub',
     "timestamp='2013-10-01'\n", CONFIG_SUB_NEW, '交叉编译识别（子项目）'),
    # 交叉编译时 configure 判定「不支持 shared libraries」，只产 .libs/libgc.a，
    # 而 Makefile 在 macOS 上要 .dylib —— 目标永远不存在，每次都重回 configure。
    # 有静态库就直接用静态库（emcc 静态链接，行为一致）。
    ('Makefile',
     'ifeq ($(UNAME_S),Darwin)\n\tBOEHM_LIB=libgc.dylib\nendif\n',
     'ifeq ($(UNAME_S),Darwin)\n\tBOEHM_LIB=libgc.dylib\nendif\n'
     '# Local patch: emscripten cross builds ship a static archive only.\n'
     'ifeq ($(wildcard vm/native/Boehm.js/.libs/libgc.a),vm/native/Boehm.js/.libs/libgc.a)\n'
     '\tBOEHM_LIB=libgc.a\n'
     'endif\n',
     '优先静态库'),
    # emcc 2.0.34 起 -s 参数只收纯数字（或 kb/mb 后缀），不再求值算术表达式。
    # 16*1024 与 128*1024*1024 都换成字节数（后者由命令行覆盖 ASMJS_TOTAL_MEMORY）。
    ('Makefile',
     '-s TOTAL_STACK=16*1024',
     '-s TOTAL_STACK=16384',
     'emcc 不再接受表达式'),
    # NO_BROWSER / NO_FILESYSTEM 在 emcc 2.x 已改名或移除（BROWSER → ENVIRONMENT，
    # FILESYSTEM 改成 -s FILESYSTEM=0）；但 FILESYSTEM=0 会让 free/memcpy/memset
    # 链接失败，最终直接去掉这两个开关，用 emcc 默认值。
    # 这一段是整行参数，用正则收敛，避免上游改写或多次运行留下中间态。
    # memcpy/memset 在 2.x 已从 library.js 移入 libc，必须显式导出，否则产物里
    # 缺这两个 JS 库函数，运行期内存操作静默损坏（表现为 Java 对象 superClass 为 null）。
    ('Makefile',
     '"_rl_set_asm_js_mode"]\'',
     '"_rl_set_asm_js_mode","_memcpy","_memset"]\'',
     '导出 memcpy/memset'),
    # 2.x 的胶水只在真正用到 HEAP8 视图时才建 Module.buffer，而 Relooper 的线程
    # 地址计算直接读 Module.buffer —— 缺了它 threadAddress 变 undefined，
    # 报出来却是一句无关的「address is number」。
    ('Makefile',
     '\techo "  return Module;" >> bld/native.js\n',
     '\techo "  if (!Module.buffer && Module.HEAP8) Module.buffer = Module.HEAP8.buffer;" >> bld/native.js\n'
     '\techo "  return Module;" >> bld/native.js\n',
     'Module.buffer 兜底'),
]

RULES = PREPROCESS_RULES + BOEHM_RULES


def apply_rule(repo, rel, old, new, note):
    path = os.path.join(repo, rel)
    if not os.path.isfile(path):
        return 'missing'
    text = open(path, encoding='utf-8', errors='surrogateescape').read()
    if new in text:
        return 'skip'                       # 已改过
    if old not in text:
        return 'absent'                     # 上游版本变了，规则失配
    text = text.replace(old, new)
    open(path, 'w', encoding='utf-8', errors='surrogateescape').write(text)
    print('  [改] %-52s %s' % (rel, note))
    return 'patched'


def patch_native_flags(repo):
    """收敛 emcc 的 native 编译参数，使其适配 emscripten 2.x + 单文件同步 wasm。

    * NO_BROWSER / NO_FILESYSTEM 已被移除（FILESYSTEM=0 还会让 free/memcpy 链接失败）；
    * DEFAULT_LIBRARY_FUNCS_TO_INCLUDE 在 2.x 不再能把 libc 符号拉进来，反而挡住解析；
    * 最终产物要能作为一个 <script> 直接加载，所以 wasm 打进同一个文件并同步实例化
      （SINGLE_FILE=1 + WASM_ASYNC_COMPILATION=0）。asm.js 在 2.x 已不可得。
    """
    path = os.path.join(repo, 'Makefile')
    if not os.path.isfile(path):
        return 'missing'
    text = open(path, encoding='utf-8', errors='surrogateescape').read()
    target = ('-s NO_EXIT_RUNTIME=1 -s SINGLE_FILE=1 -s WASM_ASYNC_COMPILATION=0 '
              '--post-js jit/relooper/glue.js')
    if target in text:
        return 'skip'
    new, n = re.subn(
        r'-s NO_EXIT_RUNTIME=1[^\n]*--post-js jit/relooper/glue\.js',
        target, text)
    if n == 0:
        return 'absent'
    # 删掉 DEFAULT_LIBRARY_FUNCS_TO_INCLUDE 那一行（带行尾续行符）
    new = re.sub(r"\n\t-s 'DEFAULT_LIBRARY_FUNCS_TO_INCLUDE=\[[^\]]*\]' \\", '', new)
    open(path, 'w', encoding='utf-8', errors='surrogateescape').write(new)
    print('  [改] %-52s %s' % ('Makefile', 'emcc 参数收敛（同步 wasm）'))
    return 'patched'


def install_files(repo):
    """把本项目自带的源文件放进上游目录（缺什么补什么）。"""
    for name in os.listdir(os.path.join(HERE, 'files')):
        dst = os.path.join(repo, 'java/custom/java/lang', name)
        src = os.path.join(HERE, 'files', name)
        if os.path.isfile(dst) and open(dst, 'rb').read() == open(src, 'rb').read():
            print('  [有] java/custom/java/lang/%s' % name)
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(src, dst)
        print('  [补] java/custom/java/lang/%s' % name)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    repo = os.path.abspath(sys.argv[1])
    if not os.path.isfile(os.path.join(repo, 'Makefile')):
        print('不是 PluotSorbet 目录：%s' % repo)
        return 1

    print('== 适配上游源码 ==')
    stats = {'patched': 0, 'skip': 0, 'missing': 0, 'absent': 0}
    for rel, old, new, note in RULES:
        stats[apply_rule(repo, rel, old, new, note)] += 1
    stats[patch_native_flags(repo)] += 1

    install_files(repo)

    print('== 完成：改 %d 处，已是目标状态 %d 处 ==' %
          (stats['patched'], stats['skip']))
    if stats['missing'] or stats['absent']:
        print('!! 有规则未命中（missing=%d absent=%d）——上游版本可能与规则不匹配，'
              '请核对后再继续。' % (stats['missing'], stats['absent']))
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
