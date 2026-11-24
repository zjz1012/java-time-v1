import javax.microedition.midlet.MIDlet;
import javax.microedition.lcdui.*;
import java.util.Random;

/**
 * 连连看 —— 自研 Canvas 版，替代原「连连看」第三方包。
 *
 * 原包主界面是 Form + ChoiceGroup，内核画不出来（见 host.html 补桩那段注释），
 * 所以这里把棋盘、光标、提示全部放进 Canvas 自己画。
 *
 * 规则：选中两张**相同图案**、且路径最多两个拐角的牌即可消除；全清过关。
 *
 * ★ 棋盘四周留一圈空位（坐标 0 与 COLS+1 / ROWS+1）：连连看允许从棋盘外侧绕行，
 *   不留这圈边界，贴边的牌永远连不上，局面会莫名卡死。
 */
public class LinkPairMidlet extends MIDlet {
    private Display display;
    private LinkCanvas canvas;

    public LinkPairMidlet() {
        display = Display.getDisplay(this);
        canvas = new LinkCanvas();
    }

    public void startApp() { canvas.start(); display.setCurrent(canvas); }
    public void pauseApp() { canvas.pause(); }
    public void destroyApp(boolean u) { canvas.stop(); }
}

class LinkCanvas extends Canvas implements Runnable {
    private static final int COLS = 8, ROWS = 8, KINDS = 6;
    /** 含外圈边界：有效坐标 1..COLS / 1..ROWS，0 与 COLS+1 恒为空。 */
    private static final int GW = COLS + 2, GH = ROWS + 2;

    private final int[][] board = new int[GH][GW];
    private int cx = 1, cy = 1;
    private int selX = -1, selY = -1;
    private int left;          // 剩余牌数
    private int moves;
    private boolean won, running;
    private Random rnd = new Random();

    LinkCanvas() { reset(); }

    private void reset() {
        for (int y = 0; y < GH; y++) for (int x = 0; x < GW; x++) board[y][x] = 0;
        int total = COLS * ROWS;
        // 成对铺牌：每两张同图案，最后整体洗牌。
        int[] pool = new int[total];
        for (int i = 0; i < total; i += 2) {
            int kind = 1 + Math.abs(rnd.nextInt()) % KINDS;
            pool[i] = kind;
            pool[i + 1] = kind;
        }
        for (int i = total - 1; i > 0; i--) {
            int j = Math.abs(rnd.nextInt()) % (i + 1);
            int t = pool[i]; pool[i] = pool[j]; pool[j] = t;
        }
        int k = 0;
        for (int y = 1; y <= ROWS; y++) for (int x = 1; x <= COLS; x++) board[y][x] = pool[k++];
        left = total;
        moves = 0;
        selX = -1; selY = -1;
        won = false;
        cx = 1; cy = 1;
    }

    void start() {
        if (running) return;
        running = true;
        new Thread(this).start();
    }
    void pause() { running = false; }
    void stop() { running = false; }

    public void run() {
        while (running) {
            repaint();
            try { Thread.sleep(80); } catch (InterruptedException e) { }
        }
    }

    // ---------------------------------------------------------------- 连通判定

    /** 同一行上 xa 与 xb 之间（不含两端）是否全空。 */
    private boolean clearH(int y, int xa, int xb) {
        int from = Math.min(xa, xb), to = Math.max(xa, xb);
        for (int x = from + 1; x < to; x++) if (board[y][x] != 0) return false;
        return true;
    }

    private boolean clearV(int x, int ya, int yb) {
        int from = Math.min(ya, yb), to = Math.max(ya, yb);
        for (int y = from + 1; y < to; y++) if (board[y][x] != 0) return false;
        return true;
    }

    /** 路径最多两个拐角 —— 连连看的标准判据。 */
    private boolean canLink(int x1, int y1, int x2, int y2) {
        if (x1 == x2 && y1 == y2) return false;
        if (board[y1][x1] == 0 || board[y1][x1] != board[y2][x2]) return false;

        // 零拐角
        if (x1 == x2 && clearV(x1, y1, y2)) return true;
        if (y1 == y2 && clearH(y1, x1, x2)) return true;

        // 一个拐角：(x2,y1) 或 (x1,y2)
        if (board[y1][x2] == 0 && clearH(y1, x1, x2) && clearV(x2, y1, y2)) return true;
        if (board[y2][x1] == 0 && clearV(x1, y1, y2) && clearH(y2, x1, x2)) return true;

        // 两个拐角：沿列扫中转点
        for (int x = 0; x < GW; x++) {
            if (x == x1 || x == x2) continue;
            if (board[y1][x] == 0 && board[y2][x] == 0
                && clearH(y1, x1, x) && clearV(x, y1, y2) && clearH(y2, x2, x)) return true;
        }
        // 沿行扫中转点
        for (int y = 0; y < GH; y++) {
            if (y == y1 || y == y2) continue;
            if (board[y][x1] == 0 && board[y][x2] == 0
                && clearV(x1, y1, y) && clearH(y, x1, x2) && clearV(x2, y2, y)) return true;
        }
        return false;
    }

    /** 还有没有可消的一对；没有就重排，否则用户会面对一局死棋。 */
    private boolean hasAnyPair() {
        for (int y1 = 1; y1 <= ROWS; y1++) for (int x1 = 1; x1 <= COLS; x1++) {
            if (board[y1][x1] == 0) continue;
            for (int y2 = y1; y2 <= ROWS; y2++) for (int x2 = 1; x2 <= COLS; x2++) {
                if (y2 == y1 && x2 <= x1) continue;
                if (board[y2][x2] == 0) continue;
                if (board[y1][x1] != board[y2][x2]) continue;
                if (canLink(x1, y1, x2, y2)) return true;
            }
        }
        return false;
    }

    private void shuffleLeft() {
        int[] pool = new int[left];
        int k = 0;
        for (int y = 1; y <= ROWS; y++) for (int x = 1; x <= COLS; x++) {
            if (board[y][x] != 0) pool[k++] = board[y][x];
        }
        for (int i = k - 1; i > 0; i--) {
            int j = Math.abs(rnd.nextInt()) % (i + 1);
            int t = pool[i]; pool[i] = pool[j]; pool[j] = t;
        }
        int p = 0;
        for (int y = 1; y <= ROWS; y++) for (int x = 1; x <= COLS; x++) {
            if (board[y][x] != 0) board[y][x] = pool[p++];
        }
    }

    // ---------------------------------------------------------------- 输入

    protected void keyPressed(int key) {
        int a = 0;
        try { a = getGameAction(key); } catch (Exception e) { }

        if (won) {
            if (key == KEY_NUM5 || a == FIRE) reset();
            return;
        }
        if (a == UP) cy = Math.max(1, cy - 1);
        else if (a == DOWN) cy = Math.min(ROWS, cy + 1);
        else if (a == LEFT) cx = Math.max(1, cx - 1);
        else if (a == RIGHT) cx = Math.min(COLS, cx + 1);
        else if (key == KEY_NUM5 || a == FIRE) {
            if (board[cy][cx] == 0) { selX = -1; return; }
            if (selX < 0) { selX = cx; selY = cy; return; }
            if (selX == cx && selY == cy) { selX = -1; return; }
            if (board[selY][selX] == board[cy][cx] && canLink(selX, selY, cx, cy)) {
                board[selY][selX] = 0;
                board[cy][cx] = 0;
                left -= 2;
                moves++;
                selX = -1;
                if (left == 0) {
                    won = true;
                } else if (!hasAnyPair()) {
                    shuffleLeft();
                }
            } else {
                // 换选：不合法就当作重新选中当前这张，比「默默什么都不做」好懂
                selX = cx; selY = cy;
            }
        }
    }

    // ---------------------------------------------------------------- 绘制

    protected void paint(Graphics g) {
        int w = getWidth(), h = getHeight();
        int fontH = g.getFont().getHeight();
        int top = fontH + 12, bottom = fontH + 10;
        int cell = Math.min((w - 8) / COLS, (h - top - bottom) / ROWS);
        if (cell < 6) cell = 6;
        int ox = (w - cell * COLS) / 2;
        int oy = top + (h - top - bottom - cell * ROWS) / 2;

        g.setColor(0x0B1016); g.fillRect(0, 0, w, h);

        g.setColor(0x1E2A38);
        g.fillRect(ox, oy, cell * COLS, cell * ROWS);

        for (int y = 1; y <= ROWS; y++) {
            for (int x = 1; x <= COLS; x++) {
                int kind = board[y][x];
                if (kind == 0) continue;
                int px = ox + (x - 1) * cell, py = oy + (y - 1) * cell;
                g.setColor(0x2A3A4D);
                g.fillRect(px + 1, py + 1, cell - 2, cell - 2);
                drawGlyph(g, kind, px, py, cell);
            }
        }

        // 选中框与光标：两层都得画，否则选中的那张被光标盖住就看不出「已选」
        if (selX > 0) frame(g, ox + (selX - 1) * cell, oy + (selY - 1) * cell, cell, 0xF2C14E);
        frame(g, ox + (cx - 1) * cell, oy + (cy - 1) * cell, cell, 0x7BE4FF);

        g.setColor(0xE6EDF3);
        g.drawString("连连看  剩 " + left, w / 2, 6, Graphics.TOP | Graphics.HCENTER);

        int msgY = Math.max(0, h - fontH - 4);
        g.setColor(won ? 0x4FD1C5 : 0x99A7B5);
        if (won) g.drawString("全清！5 再来一局", w / 2, msgY, Graphics.TOP | Graphics.HCENTER);
        else g.drawString("方向键选牌 · 5 消一对", w / 2, msgY, Graphics.TOP | Graphics.HCENTER);
    }

    private void frame(Graphics g, int x, int y, int cell, int color) {
        g.setColor(color);
        g.drawRect(x, y, cell - 1, cell - 1);
        g.drawRect(x + 1, y + 1, cell - 3, cell - 3);
    }

    /** 六种图案用几何形状区分，不依赖图片资源。 */
    private void drawGlyph(Graphics g, int kind, int px, int py, int cell) {
        int s = cell - 6;
        int x = px + 3, y = py + 3;
        switch (kind) {
            case 1:
                g.setColor(0xFF6B6B); g.fillRect(x, y, s, s); break;
            case 2:
                g.setColor(0x7BE4FF); g.fillArc(x, y, s, s, 0, 360); break;
            case 3:
                g.setColor(0xF2C14E);
                g.fillTriangle(x + s / 2, y, x, y + s, x + s, y + s); break;
            case 4:
                g.setColor(0x4FD1C5);
                g.fillRect(x + s / 3, y, s / 3, s);
                g.fillRect(x, y + s / 3, s, s / 3); break;
            case 5:
                g.setColor(0xC792EA);
                g.fillRect(x, y + s / 2 - 1, s, Math.max(2, s / 4)); break;
            default:
                g.setColor(0x63E6BE);
                g.fillRect(x, y, s / 2, s / 2);
                g.fillRect(x + s / 2, y + s / 2, s / 2, s / 2); break;
        }
    }
}
