import javax.microedition.midlet.MIDlet;
import javax.microedition.lcdui.*;
import java.util.Random;

/**
 * 坠落方块 —— 自研 J2ME 实现。
 *
 * ★ 为什么叫这个、不叫「俄罗斯方块」：
 *   TETRIS 是 Tetris Holding LLC 的注册商标，中文「俄罗斯方块」是它的通行译名，
 *   在游戏类目上同样有商标风险，所以名字和 logo 都避开。
 *
 * ★ 关于玩法：Tetris Holding v. Xio Interactive（D.N.J. 2012）确立的边界是——
 *   规则不受保护（"Tetris Holding has given the rules of its game to the public domain"），
 *   但"方块的样式、设计、形状与运动"属于表达。Xio 败诉的事实基础是：
 *   同样 7 种形状 + 同样板面尺寸 + 同样的整体观感，法院用了 "squint test"。
 *   因此本实现刻意在三处与它区分开：
 *     · 名称不同，全程不出现 TETRIS 字样
 *     · 板面 10×16（经典款是 10×20）
 *     · 方块是圆角 + 顶部内高光的扁平块，配色自成一套，无斜面立体描边
 *   七种 four-square 形状（tetromino）本身是 1953 年 Golomb 命名的数学对象，
 *   并非某家独创，这一点在任何一份公开的 polyomino 文献里都能查到。
 *
 * 代码：全部自研，无第三方依赖、无美术资源。
 */
public class DropMidlet extends MIDlet {
    private Display display;
    private DropCanvas canvas;

    public DropMidlet() {
        display = Display.getDisplay(this);
        canvas = new DropCanvas();
    }
    public void startApp() { display.setCurrent(canvas); canvas.start(); }
    public void pauseApp() { canvas.stop(); }
    public void destroyApp(boolean u) { canvas.stop(); }
}

class DropCanvas extends Canvas implements Runnable {
    private static final int COLS = 10, ROWS = 16;

    /**
     * 7 种方块 × 4 个旋转态，各用一个 16 位整数表示 4×4 网格（bit15 = 左上）。
     * 用位板而不是坐标数组，碰撞检测就是一次移位判断，省掉一堆边界代码。
     */
    private static final int[][] SHAPES = {
        // I
        {0x0F00, 0x2222, 0x00F0, 0x4444},
        // O
        {0x6600, 0x6600, 0x6600, 0x6600},
        // T
        {0x4E00, 0x4640, 0x0E40, 0x4C40},
        // S
        {0x6C00, 0x4620, 0x06C0, 0x8C40},
        // Z
        {0xC600, 0x2640, 0x0C60, 0x4C80},
        // J
        {0x44C0, 0x8E00, 0x6440, 0x0E20},
        // L
        {0x4460, 0x0E80, 0x8C40, 0x2E00},
    };

    /** 七色自成一套（薄荷/金/紫/青/珊瑚/靛/橙），明度比街机原版更柔，配深色底 */
    private static final int[] COLORS = {
        0x7BE8B6, 0xF2C14E, 0xC084FC, 0x4FD1C5, 0xFF7A6B, 0x6C8EF5, 0xE8935A,
    };

    private byte[] board = new byte[COLS * ROWS];
    private int type, rot, bx, by, next;
    private int score, lines, level;
    private boolean over, running, paused;
    private Random rnd = new Random();
    private int cell, ox, oy, topH;

    DropCanvas() { reset(); }

    void start() {
        if (running) return;
        running = true;
        new Thread(this).start();
    }
    void stop() { running = false; }

    private void reset() {
        for (int i = 0; i < board.length; i++) board[i] = 0;
        score = 0;
        lines = 0;
        level = 1;
        over = false;
        paused = false;
        next = Math.abs(rnd.nextInt()) % 7;
        spawn();
    }

    private void spawn() {
        type = next;
        next = Math.abs(rnd.nextInt()) % 7;
        rot = 0;
        bx = 3;
        by = -1; // 从板面上方一格开始，I 的横条正好落在第 0 行
        if (!fits(type, rot, bx, by)) {
            // 出生态被占 ⇒ 顶死。先试正上方一格（by=0）能否放下，
            // 放不下才判负 —— 否则 I 横条刚出生就被误判成游戏结束。
            by = 0;
            if (!fits(type, rot, bx, by)) over = true;
        }
    }

    private boolean fits(int t, int r, int px, int py) {
        int bits = SHAPES[t][r];
        for (int row = 0; row < 4; row++) {
            for (int col = 0; col < 4; col++) {
                if ((bits & (0x8000 >> (row * 4 + col))) == 0) continue;
                int xx = px + col, yy = py + row;
                if (xx < 0 || xx >= COLS || yy >= ROWS) return false;
                if (yy >= 0 && board[yy * COLS + xx] != 0) return false;
            }
        }
        return true;
    }

    private void rotate() {
        int nr = (rot + 1) & 3;
        // 简易 wall kick：贴墙或贴块时左右各让 1~2 格，不然靠边的方块永远转不动
        int[] kick = {0, -1, 1, -2, 2};
        for (int i = 0; i < kick.length; i++) {
            if (fits(type, nr, bx + kick[i], by)) {
                rot = nr;
                bx += kick[i];
                return;
            }
        }
    }

    private void hardDrop() {
        while (fits(type, rot, bx, by + 1)) {
            by++;
            score += 1;
        }
        lockPiece();
    }

    private void lockPiece() {
        int bits = SHAPES[type][rot];
        for (int row = 0; row < 4; row++) {
            for (int col = 0; col < 4; col++) {
                if ((bits & (0x8000 >> (row * 4 + col))) == 0) continue;
                int xx = bx + col, yy = by + row;
                if (yy >= 0 && yy < ROWS && xx >= 0 && xx < COLS) {
                    board[yy * COLS + xx] = (byte) (type + 1);
                }
            }
        }
        int cleared = clearLines();
        if (cleared > 0) {
            // 1/2/3/4 行分别 100/300/500/800，再乘等级 —— 一次消四行的收益必须远高于四次单消
            int base = cleared == 4 ? 800 : (cleared == 3 ? 500 : (cleared == 2 ? 300 : 100));
            score += base * level;
            lines += cleared;
            level = lines / 10 + 1;
        }
        spawn();
    }

    private int clearLines() {
        int n = 0;
        for (int r = ROWS - 1; r >= 0; r--) {
            boolean full = true;
            for (int c = 0; c < COLS; c++) {
                if (board[r * COLS + c] == 0) { full = false; break; }
            }
            if (!full) continue;
            n++;
            for (int rr = r; rr > 0; rr--) {
                for (int c = 0; c < COLS; c++) board[rr * COLS + c] = board[(rr - 1) * COLS + c];
            }
            for (int c = 0; c < COLS; c++) board[c] = 0;
            r++; // 搬下来一行，当前行要重判
        }
        return n;
    }

    /** 每 10 行升一级，单步间隔从 560ms 压到 130ms 封底 —— 再快就不是人玩的 */
    private int speed() {
        int s = 560 - (level - 1) * 45;
        return s < 130 ? 130 : s;
    }

    public void run() {
        while (running) {
            if (!over && !paused) {
                if (fits(type, rot, bx, by + 1)) {
                    by++;
                } else {
                    lockPiece();
                }
                repaint();
            }
            try {
                Thread.sleep(over ? 220 : (paused ? 120 : speed()));
            } catch (InterruptedException e) { }
        }
    }

    // ---------------- 绘制 ----------------

    protected void paint(Graphics g) {
        int w = getWidth(), h = getHeight();
        g.setColor(0x0B1016);
        g.fillRect(0, 0, w, h);

        topH = 30;
        Font sf = Font.getFont(Font.FACE_PROPORTIONAL, Font.STYLE_BOLD, Font.SIZE_SMALL);
        // 底部留白必须按字高算，不能写死 18：240×320 下写死会让板底压到提示文字上
        // （截图上直接看到最底两行方块被「OK 直落…」盖住）。
        int bottom = sf.getHeight() + 6;
        int sideW = w / 4;
        cell = Math.min((w - sideW - 10) / COLS, (h - topH - bottom) / ROWS);
        if (cell < 8) cell = 8;
        ox = 6;
        oy = topH + Math.max(0, (h - topH - bottom - cell * ROWS) / 2);

        g.setFont(sf);
        g.setColor(0xE6EDF3);
        g.drawString("坠落方块", 8, 5, Graphics.TOP | Graphics.LEFT);

        // 板面
        g.setColor(0x0E141B);
        g.fillRect(ox, oy, cell * COLS, cell * ROWS);
        g.setColor(0x1A222C);
        for (int r = 1; r < ROWS; r++) g.drawLine(ox, oy + r * cell, ox + cell * COLS, oy + r * cell);
        for (int c = 1; c < COLS; c++) g.drawLine(ox + c * cell, oy, ox + c * cell, oy + cell * ROWS);

        for (int r = 0; r < ROWS; r++) {
            for (int c = 0; c < COLS; c++) {
                int v = board[r * COLS + c];
                if (v != 0) block(g, ox + c * cell, oy + r * cell, COLORS[v - 1]);
            }
        }

        // 落点提示：只在当前块还能落时画一条底线，比画整块虚影省事也更清晰
        int ghost = by;
        while (fits(type, rot, bx, ghost + 1)) ghost++;
        int bits = SHAPES[type][rot];
        for (int row = 0; row < 4; row++) {
            for (int col = 0; col < 4; col++) {
                if ((bits & (0x8000 >> (row * 4 + col))) == 0) continue;
                int xx = bx + col, yy = ghost + row;
                if (yy < 0) continue;
                g.setColor(0x2E4258); // 太暗（0x233040）在手机上等于没画
                g.drawRect(ox + xx * cell + 1, oy + yy * cell + 1, cell - 3, cell - 3);
            }
        }
        for (int row = 0; row < 4; row++) {
            for (int col = 0; col < 4; col++) {
                if ((bits & (0x8000 >> (row * 4 + col))) == 0) continue;
                int xx = bx + col, yy = by + row;
                if (yy < 0) continue;
                block(g, ox + xx * cell, oy + yy * cell, COLORS[type]);
            }
        }

        // 侧栏：下一块 + 分数/行数/等级
        int sx = ox + cell * COLS + 8;
        g.setColor(0x6B7A89);
        g.drawString("NEXT", sx, oy + 2, Graphics.TOP | Graphics.LEFT);
        int nb = SHAPES[next][0];
        int nc = Math.max(4, cell / 2);
        for (int row = 0; row < 4; row++) {
            for (int col = 0; col < 4; col++) {
                if ((nb & (0x8000 >> (row * 4 + col))) == 0) continue;
                block(g, sx + col * nc, oy + 16 + row * nc, COLORS[next]);
            }
        }
        int ty = oy + 16 + 4 * nc + 12;
        g.setColor(0x3ECF8E);
        g.drawString(String.valueOf(score), sx, ty, Graphics.TOP | Graphics.LEFT);
        g.setColor(0x6B7A89);
        g.drawString("分", sx, ty + sf.getHeight(), Graphics.TOP | Graphics.LEFT);
        g.setColor(0xE6EDF3);
        g.drawString("行 " + lines, sx, ty + sf.getHeight() * 2 + 4, Graphics.TOP | Graphics.LEFT);
        g.drawString("级 " + level, sx, ty + sf.getHeight() * 3 + 4, Graphics.TOP | Graphics.LEFT);

        int msgY = h - sf.getHeight() - 3;
        g.setColor(over ? 0xFF6B6B : 0x6B7A89);
        g.drawString(over ? "堆满了 · 按 OK 重开" : "OK 直落 · ↑旋转 · ↓软降",
                     w / 2, msgY, Graphics.TOP | Graphics.HCENTER);
    }

    /** 圆角 + 顶部内高光：和经典款的斜面立体块拉开距离，也省掉逐像素描边 */
    private void block(Graphics g, int x, int y, int color) {
        int s = cell - 1;
        g.setColor(color);
        g.fillRoundRect(x, y, s, s, 5, 5);
        g.setColor(0xFFFFFF);
        g.fillRect(x + 2, y + 1, s - 4, 1);
    }

    protected void keyPressed(int key) {
        int a = 0;
        try { a = getGameAction(key); } catch (Exception e) { }

        if (over) {
            if (key == KEY_NUM5 || a == FIRE || key == -6 || key == -7) {
                reset();
                repaint();
            }
            return;
        }
        if (a == LEFT) {
            if (fits(type, rot, bx - 1, by)) bx--;
        } else if (a == RIGHT) {
            if (fits(type, rot, bx + 1, by)) bx++;
        } else if (a == UP) {
            rotate();
        } else if (a == DOWN) {
            if (fits(type, rot, bx, by + 1)) { by++; score += 1; }
            else lockPiece();
        } else if (key == KEY_NUM5 || a == FIRE) {
            hardDrop();
        } else if (key == -6 || key == -7) {
            paused = !paused;
        }
        repaint();
    }
}
