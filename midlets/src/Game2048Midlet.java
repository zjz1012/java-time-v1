import javax.microedition.midlet.MIDlet;
import javax.microedition.lcdui.*;
import java.util.Random;

/**
 * 2048 —— 自研 J2ME 实现。
 *
 * 玩法来源：Gabriele Cirulli 2014 年的 2048（MIT 许可）。规则属于"思想/方法"，
 * 不受著作权保护；本文件是照着规则从零写的 Java 实现，没有移植其 JS 代码，
 * 也没有使用它的 CSS 配色。名称「2048」是规则里的目标数字，非某家的商标。
 *
 * 规则要点（照 2048 官方口径）：
 *   · 4×4 盘，初始两块；每次有效移动后随机空位补一块，2 占 90%、4 占 10%
 *   · 同值相邻合并成双倍，一次移动里每块只参与一次合并
 *   · 计分 = 合并出的新块数值累加
 *   · 无空格且无相邻同值 ⇒ 结束
 */
public class Game2048Midlet extends MIDlet {
    private Display display;
    private Game2048Canvas canvas;

    public Game2048Midlet() {
        display = Display.getDisplay(this);
        canvas = new Game2048Canvas();
    }
    public void startApp() { display.setCurrent(canvas); }
    public void pauseApp() { }
    public void destroyApp(boolean u) { }
}

class Game2048Canvas extends Canvas {
    private static final int N = 4;
    private int[] g = new int[N * N];
    private int score, best, moved;
    private boolean over, reached;
    private Random rnd = new Random();

    Game2048Canvas() { newGame(); }

    private void newGame() {
        for (int i = 0; i < g.length; i++) g[i] = 0;
        score = 0;
        over = false;
        reached = false;
        moved = 0;
        spawn();
        spawn();
    }

    /** 90% 出 2、10% 出 4 —— 这个比例是手感的一部分，改成五五开会立刻变简单 */
    private void spawn() {
        int empty = 0;
        for (int i = 0; i < g.length; i++) if (g[i] == 0) empty++;
        if (empty == 0) return;
        int pick = Math.abs(rnd.nextInt()) % empty;
        for (int i = 0; i < g.length; i++) {
            if (g[i] != 0) continue;
            if (pick == 0) {
                g[i] = (Math.abs(rnd.nextInt()) % 10 == 0) ? 4 : 2;
                return;
            }
            pick--;
        }
    }

    private boolean canMove() {
        for (int i = 0; i < g.length; i++) if (g[i] == 0) return true;
        for (int r = 0; r < N; r++) {
            for (int c = 0; c < N; c++) {
                int v = g[r * N + c];
                if (c + 1 < N && g[r * N + c + 1] == v) return true;
                if (r + 1 < N && g[(r + 1) * N + c] == v) return true;
            }
        }
        return false;
    }

    /**
     * 把一条线上的 4 个数朝 dir 方向挤压并合并。
     * 合并必须"成对跳着走"：先收集非零，再用双指针一趟扫完。
     * 早先写成"合并后左移"的版本，[4,4,8,8] 会变成 [8,8,8,0] —— 因为左移把
     * 原本被隔开的两块挤到一起，第二对就误判成可合并了。
     */
    private int[] line;

    private boolean slide(int dir) { // 0 上, 1 右, 2 下, 3 左
        boolean changed = false;
        for (int i = 0; i < N; i++) {
            int[] src = new int[N];
            for (int j = 0; j < N; j++) {
                int x, y;
                if (dir == 0) { x = i; y = j; }
                else if (dir == 2) { x = i; y = N - 1 - j; }
                else if (dir == 3) { x = j; y = i; }
                else { x = N - 1 - j; y = i; }
                src[j] = g[y * N + x];
            }
            int[] dst = merge(src);
            for (int j = 0; j < N; j++) {
                int x, y;
                if (dir == 0) { x = i; y = j; }
                else if (dir == 2) { x = i; y = N - 1 - j; }
                else if (dir == 3) { x = j; y = i; }
                else { x = N - 1 - j; y = i; }
                if (g[y * N + x] != dst[j]) changed = true;
                g[y * N + x] = dst[j];
            }
        }
        return changed;
    }

    private int[] merge(int[] src) {
        int[] tmp = new int[N];
        int k = 0;
        for (int i = 0; i < N; i++) if (src[i] != 0) tmp[k++] = src[i];
        int[] out = new int[N];
        int m = 0, i = 0;
        while (i < k) {
            if (i + 1 < k && tmp[i] == tmp[i + 1]) {
                int v = tmp[i] * 2;
                out[m++] = v;
                score += v;
                if (v >= 2048) reached = true;
                i += 2;
            } else {
                out[m++] = tmp[i];
                i++;
            }
        }
        return out;
    }

    private void move(int dir) {
        if (over) return;
        if (!slide(dir)) return;
        moved++;
        spawn();
        if (score > best) best = score;
        if (!canMove()) over = true;
    }

    // ---------------- 绘制 ----------------

    private int cell, gap, ox, oy;

    private int tileBg(int v) {
        switch (v) {
            case 0: return 0x151C25;
            case 2: return 0x232E3B;
            case 4: return 0x2B3A49;
            case 8: return 0x2E5548;
            case 16: return 0x33705A;
            case 32: return 0x388A6B;
            case 64: return 0x3ECF8E;
            case 128: return 0x5BDCA0;
            case 256: return 0x7BE8B6;
            case 512: return 0xA3F0D0;
            case 1024: return 0xEDCF72;
            case 2048: return 0xF2C14E;
            default: return 0xFFD76E;
        }
    }

    protected void paint(Graphics g) {
        int w = getWidth(), h = getHeight();
        g.setColor(0x0B1016);
        g.fillRect(0, 0, w, h);

        int top = 36, bottom = 20;
        int board = Math.min(w - 14, h - top - bottom);
        cell = board / N;
        gap = Math.max(3, cell / 14);
        ox = (w - cell * N) / 2;
        oy = top + (h - top - bottom - cell * N) / 2;
        if (oy < top) oy = top;

        Font sf = Font.getFont(Font.FACE_PROPORTIONAL, Font.STYLE_BOLD, Font.SIZE_SMALL);
        g.setFont(sf);
        g.setColor(0x3ECF8E);
        g.drawString("2048", 8, 5, Graphics.TOP | Graphics.LEFT);
        g.setColor(0x8A99A8);
        g.drawString("分数 " + score + "   最高 " + best, w - 8, 5,
                     Graphics.TOP | Graphics.RIGHT);

        for (int r = 0; r < N; r++) {
            for (int c = 0; c < N; c++) {
                int v = this.g[r * N + c];
                int x = ox + c * cell + gap / 2, y = oy + r * cell + gap / 2;
                int s = cell - gap;
                g.setColor(tileBg(v));
                g.fillRoundRect(x, y, s, s, 8, 8);
                if (v == 0) continue;
                String txt = String.valueOf(v);
                Font f = Font.getFont(Font.FACE_PROPORTIONAL, Font.STYLE_BOLD,
                                     v >= 1024 ? Font.SIZE_SMALL : (v >= 128 ? Font.SIZE_MEDIUM : Font.SIZE_LARGE));
                // 兜底：字体挑得再准也要量一遍，宁可缩一级也别让四位数顶出格子
                while (f.stringWidth(txt) > s - 6 && f.getSize() != Font.SIZE_SMALL) {
                    f = Font.getFont(Font.FACE_PROPORTIONAL, Font.STYLE_BOLD, Font.SIZE_SMALL);
                    break;
                }
                g.setFont(f);
                g.setColor(v >= 64 ? 0x062016 : 0xE6EDF3);
                g.drawString(txt, x + s / 2, y + s / 2 - f.getHeight() / 2,
                             Graphics.TOP | Graphics.HCENTER);
            }
        }

        int msgY = h - sf.getHeight() - 5;
        g.setFont(sf);
        g.setColor(over ? 0xFF6B6B : (reached ? 0x3ECF8E : 0x6B7A89));
        if (over) g.drawString("无处可走 · 按 OK 重开", w / 2, msgY, Graphics.TOP | Graphics.HCENTER);
        else if (reached) g.drawString("2048 达成！可继续冲更高 · 按 OK 重开", w / 2, msgY, Graphics.TOP | Graphics.HCENTER);
        else g.drawString("方向键滑动 · 按 OK 重开", w / 2, msgY, Graphics.TOP | Graphics.HCENTER);
    }

    protected void keyPressed(int key) {
        int a = 0;
        try { a = getGameAction(key); } catch (Exception e) { }
        if (a == UP) move(0);
        else if (a == RIGHT) move(1);
        else if (a == DOWN) move(2);
        else if (a == LEFT) move(3);
        else if (key == KEY_NUM5 || a == FIRE || key == -6 || key == -7) newGame();
        // ★ 必须显式重绘。这一款没有动画线程，数据改了屏幕不会自己更新 ——
        //   表现是"按键完全没反应"，但盘面数据其实已经变了。另外两款有 run() 循环
        //   一直 repaint，所以同样的写法在它们身上不会暴露这个问题。
        repaint();
    }
}
