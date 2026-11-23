#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把上游 PluotSorbet 的运行时源文件拼成 bld/main-all.js，并打三处外壳适配补丁。

上游用 closure 编译，我们不用 closure（它会改语义、且需要特定版本）。
直接按清单顺序拼接，再逐条应用补丁：

  1. 去掉各文件独立的 'use strict' —— libs/forge 里有 `delete define`，
     严格模式在语法检查阶段就会失败（浏览器整段不执行）。
  2. splash/download 的 removeChild 加父节点守卫 —— 上游假定这两个节点是
     #display 的直接子级，本外壳把它们放在 drawer/main 下面。
  3. 删掉尾部对 #up/#down/#left/#right/#fire 的静态 onmousedown 绑定 ——
     那是上游页面的 UI 层，本外壳由 keypad 统一接管，留着会双触发。
  4. mobileInfo 不再等宿主管道 —— 本环境没有宿主，等下去 start() 永不执行。
  5. main.js 只取启动段（调试面板整段丢弃），并补一段由 MANIFEST 推断主类。

用法：
    python3 build-main-all.py <pluotsorbet 目录> <输出文件>
"""
import os
import re
import sys


def read_sources(repo):
    """按 Makefile 的 MAIN_JS_SRCS 顺序取出源文件清单。

    MAIN_JS_SRCS 有一段多行续行清单（以反斜杠结尾），后面还有若干
    条件追加（MAIN_JS_SRCS += xxx）。只认这两种，别把 CPPFLAGS 之类抓进来。
    """
    lines = open(os.path.join(repo, 'Makefile')).read().split('\n')
    files = []
    i = 0
    while i < len(lines):
        m = re.match(r'^MAIN_JS_SRCS\s*\+?=\s*(.*)$', lines[i])
        if m:
            rest = m.group(1)
            if rest.rstrip().endswith('\\'):
                i += 1
                while i < len(lines):
                    item = lines[i].strip()
                    cont = item.endswith('\\')
                    item = item.rstrip('\\').strip()
                    if item and item != '$(NULL)':
                        files.append(item)
                    if not cont:
                        break
                    i += 1
            else:
                item = rest.strip()
                if item and item != '$(NULL)':
                    files.append(item)
        i += 1

    # 去重保序
    seen = set()
    ordered = []
    for f in files:
        if f not in seen:
            seen.add(f)
            ordered.append(f)
    return ordered


PIPE_OLD = '''if (window.parent !== window) {
  alert = function(message) {
    window.parent.DumbPipe.handleEvent({
      detail: {
        promptType: "alert",
        message: message,
      }
    });
  };

  prompt = function(message) {
    var event = {
      detail: {
        promptType: "prompt",
        message: message,
        unblock: function() {},
      }
    };
    window.parent.DumbPipe.handleEvent(event);
    return event.detail.returnValue;
  };
}'''

PIPE_NEW = '''if (window.parent !== window) {
  /* 上游假定父窗口提供 Firefox OS 的 DumbPipe（mozbrowser 时代约定）。
     现代 Web 没有这个对象，直接取 window.parent.DumbPipe.handleEvent 会抛
     TypeError，而这段在启动链上，症状是「内核不启动、控制台只有一句话」。
     没有管道时退化为控制台输出：MIDlet 继续跑，告警不丢，只是不进系统弹窗。 */
  alert = function(message) {
    var pipe = window.parent && window.parent.DumbPipe;
    if (pipe) {
      pipe.handleEvent({
        detail: {
          promptType: "alert",
          message: message,
        }
      });
    } else {
      console.warn("[midlet alert] " + message);
    }
  };

  prompt = function(message) {
    var event = {
      detail: {
        promptType: "prompt",
        message: message,
        unblock: function() {},
      }
    };
    var pipe = window.parent && window.parent.DumbPipe;
    if (pipe) {
      pipe.handleEvent(event);
      return event.detail.returnValue;
    }
    return null;
  };
}'''


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    repo, out = sys.argv[1], sys.argv[2]
    sources = read_sources(repo)

    missing = [f for f in sources if not os.path.isfile(os.path.join(repo, f))]
    if missing:
        print('缺少源文件: ' + ', '.join(missing))
        return 1

    chunks = []
    for f in sources:
        path = os.path.join(repo, f)
        if f == 'main.js':
            chunks.append(trim_main(path))
        else:
            chunks.append(open(path).read())

    js = '\n'.join(chunks)

    # 补丁 1：去掉独立成行的 use strict
    js = re.sub(r'(?m)^\s*[\'"]use strict[\'"];?\s*$', '', js)

    # 补丁 2：removeChild 守卫
    js = js.replace(
        'display.removeChild(splashScreen);',
        'if (splashScreen && splashScreen.parentNode === display) display.removeChild(splashScreen);')
    js = js.replace(
        'display.removeChild(downloadDialog);',
        'if (downloadDialog && downloadDialog.parentNode === display) display.removeChild(downloadDialog);')

    # 补丁 3：删掉静态方向键绑定段
    js = strip_key_bindings(js)

    # 补丁 4：mobileInfo 立即兑现
    js = re.sub(
        r'var getMobileInfo = new Promise\(function\(resolve, reject\) \{\n'
        r'  var sender = DumbPipe\.open\("mobileInfo".*?\n\}\);',
        'var getMobileInfo = new Promise(function(resolve, reject) {\n'
        '  // 本环境没有宿主可应答 mobileInfo，等待会让 start() 永远不执行。\n'
        '  resolve();\n'
        '});',
        js, flags=re.S)

    # 补丁 5：Configuration.getProperty0 里的 startsWith 需要空值守卫
    js = js.replace(
        'if (config.midletClassName == "RunTestsMIDlet" ||\n'
        '            config.midletClassName.startsWith("benchmark")) {',
        'if (config.midletClassName == "RunTestsMIDlet" ||\n'
        '            (config.midletClassName && config.midletClassName.indexOf("benchmark") === 0)) {')

    # 补丁 6：启动时收掉下载遮罩。上游靠页面上的按钮触发，本环境没有按钮。
    js = js.replace(
        '  function run() {\n'
        '    J2ME.Context.setWriters(new J2ME.IndentingWriter());',
        '  function run() {\n'
        '    hideDownloadScreen();\n'
        '    J2ME.Context.setWriters(new J2ME.IndentingWriter());')

    # 补丁 7：父窗口没有 DumbPipe 时不抛错
    if PIPE_OLD not in js:
        raise SystemExit('补丁 7 未命中：上游 libs/pipe.js 的父窗口假设段已变化')
    js = js.replace(PIPE_OLD, PIPE_NEW)

    open(out, 'w').write(js)
    print('已生成 %s（%d 字节 / %d 行）' % (out, len(js), js.count('\n') + 1))
    return 0


def trim_main(path):
    """main.js 只保留启动段，丢弃后面的开发者调试面板，并补主类推断。"""
    src = open(path).read()
    marker = 'Promise.all(loadingPromises).then(start, function (reason) {'
    idx = src.find(marker)
    if idx < 0:
        raise SystemExit('main.js 里找不到启动段结束标记')
    end = src.find('});', idx) + 3
    head = src[:end]

    anchor = ('jars.forEach(function(jar) {\n'
              '  loadingMIDletPromises.push(load(jar, "arraybuffer").then(function(data) {\n'
              '    JARStore.addBuiltIn(jar, data);\n'
              '  }));\n'
              '});')
    if anchor not in head:
        raise SystemExit('main.js 里找不到 jar 加载段')

    # 平台分发时 .jar 会被丢弃，类库实际以 .data 存放；
    # addBuiltIn 里的虚拟名保持 classes.jar 不变（内核按这个名字索引）。
    head = head.replace(
        'load("java/classes.jar", "arraybuffer")',
        'load("java/classes.data", "arraybuffer")')

    patch = anchor + '''

/* 由 JAR 自身的 MANIFEST.MF 推断主类。
   config.midletClassName 在上游是靠页面上的选择器填的；本环境一个包一个游戏，
   没有选择器，所以装完包直接读 MIDlet-1。
   读不到就保持 undefined，由 MIDletSuiteLoader 走默认路径。 */
function inferMidletClassName(jarName) {
  if (config.midletClassName) {
    return;
  }
  var bytes = JARStore.loadFileFromJAR(jarName, "META-INF/MANIFEST.MF");
  if (!bytes) {
    return;
  }
  var text = "";
  for (var i = 0; i < bytes.length; i++) {
    text += String.fromCharCode(bytes[i]);
  }
  // MANIFEST 的续行以单个空格开头，先并回逻辑行再按名字取。
  var lines = text.replace(/\\r\\n|\\r/g, "\\n").split("\\n");
  var logical = [];
  for (var j = 0; j < lines.length; j++) {
    if (lines[j].charAt(0) === " " && logical.length) {
      logical[logical.length - 1] += lines[j].substring(1);
    } else {
      logical.push(lines[j]);
    }
  }
  for (var k = 0; k < logical.length; k++) {
    var m = /^MIDlet-1\\s*:\\s*(.*)$/.exec(logical[k]);
    if (m) {
      var parts = m[1].split(",");
      var name = parts[parts.length - 1].trim();
      if (name) {
        config.midletClassName = name.replace(/\\//g, ".");
      }
      return;
    }
  }
}

jars.forEach(function(jar) {
  loadingMIDletPromises.push(load(jar, "arraybuffer").then(function(data) {
    JARStore.addBuiltIn(jar, data);
    inferMidletClassName(jar);
  }));
});'''

    return head.replace(anchor, patch)


def strip_key_bindings(js):
    """删掉 up/down/left/right/fire 的静态事件绑定段。"""
    start_marker = 'document.getElementById("up").onmousedown = function() {'
    end_marker = 'document.getElementById("fire").onmouseup = function() {'
    start = js.find(start_marker)
    if start < 0:
        return js
    end = js.find(end_marker, start)
    if end < 0:
        raise SystemExit('找到方向键绑定起点但没有终点')
    # fire.onmouseup 的函数体以单独的 "}" 行结束
    close = js.find('\n}', end) + 2
    removed = js[start:close]
    print('  剥离静态键位绑定 %d 字节' % len(removed))
    return js[:start] + js[close:]


if __name__ == '__main__':
    sys.exit(main())
