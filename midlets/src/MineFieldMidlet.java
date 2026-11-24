import javax.microedition.midlet.MIDlet;
import javax.microedition.lcdui.*;
import java.util.Random;

/**
 * 扫雷 —— 自研 Canvas 版，替代原「扫雷」第三方包。
 *
 * 原包同时缺 Ticker 与 ChoiceGroup：内核这两样都没有实现，启动直接卡死。
 * 自研版不碰 Form，标题也不做滚动字幕。
 *
 * ★ 第一次翻开必定安全：若首点落在雷上就整盘重布。这不是「作弊」，是扫雷的通行
 *   规则 —— 否则第一步踩雷的挫败感与技巧无关，纯运气。
 */
public class MineFieldMidlet extends MIDlet {
    private Display display;
    private MineCanvas canvas;

    public MineFieldMidlet() {
        display = Display.getDisplay(this);
        canvas = new MineCanvas();
    }

    public void startApp() { canvas.start(); display.setCurrent(canvas); }
    public void pauseApp() { canvas.pause(); }
    public void destroyApp(boolean u) { canvas.stop(); }
}

class MineCanvas extends Canvas implements Runnable {
    private static final int COLS = 9, ROWS = 9, MINES = 10;

    private final boolean[][] mine = new boolean[ROWS][COLS];
    private final boolean[][] open = new boolean[ROWS][COLS];
    private final boolean[][] flag = new boolean[ROWS][COLS];
    private final int[][] near = new int[ROWS][COLS];

    private int cx, cy;
    private boolean first = true, dead, won, running;
    private int opened, flagCount;
    private long startedAt, elapsed;
    private Random rnd = new Random();

    MineCanvas() { reset(); }

    private void reset() {
        for (int y = 0; y < ROWS; y++) for (int x = 0; x < COLS; x++) {
            mine[y][x] = false; open[y][x] = false; flag[y][x] = false; near[y][x] = 0;
        }
        cx = COLS / 2; cy = ROWS / 2;
        first = true; dead = false; won = false; opened = 0; flagCount = 0;
        startedAt = 0; elapsed = 0;
    }

    private void placeMines(int safeX, int safeY) {
        int placed = 0;
        while (placed < MINES) {
            int x = Math.abs(rnd.nextInt()) % COLS;
            int y = Math.abs(rnd.nextInt()) % ROWS;
            if (mine[y][x]) continue;
            // 首点及其周围 8 格都不布雷：第一下就开出数字才符合直觉
            if (Math.abs(x - safeX) <= 1 && Math.abs(y - safeY) <= 1) continue;
            mine[y][x] = true;
            placed++;
        }
        for (int y = 0; y < ROWS; y++) for (int x = 0; x < COLS; x++) {
            int n = 0;
            for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
                int nx = x + dx, ny = y + dy;
                if (nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS && mine[ny][nx]) n++;
            }
            near[y][x] = n;
        }
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
            if (!dead && !won && startedAt > 0) elapsed = System.currentTimeMillis() - startedAt;
            repaint();
            try { Thread.sleep(100); } catch (InterruptedException e) { }
        }
    }

    private void floodOpen(int sx, int sy) {
        // 显式队列：递归在 CLDC 上会爆栈，而且这里一次可能展开几十格。
        // 入队时就置 open，保证每格只进队一次 —— 否则队列容量得按 8 倍预留。
        int[] qx = new int[ROWS * COLS];
        int[] qy = new int[ROWS * COLS];
        int head = 0, tail = 0;

        open[sy][sx] = true;
        opened++;
        if (mine[sy][sx]) { dead = true; return; }
        qx[tail] = sx; qy[tail] = sy; tail++;

        while (head < tail) {
            int x = qx[head], y = qy[head]; head++;
            if (near[y][x] != 0) continue;
            for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
                int nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
                if (open[ny][nx] || flag[ny][nx]) continue;
                open[ny][nx] = true;
                opened++;
                qx[tail] = nx; qy[tail] = ny; tail++;
            }
        }
    }

    private void reveal() {
        if (open[cy][cx] || flag[cy][cx]) return;
        if (first) {
            placeMines(cx, cy);
            first = false;
            startedAt = System.currentTimeMillis();
        }
        floodOpen(cx, cy);
        if (!dead && opened >= ROWS * COLS - MINES) won = true;
    }

    private void toggleFlag() {
        if (open[cy][cx]) return;
        if (!flag[cy][cx] && flagCount >= MINES) return;
        flag[cy][cx] = !flag[cy][cx];
        flagCount += flag[cy][cx] ? 1 : -1;
    }

    protected void keyPressed(int key) {
        int a = 0;
        try { a = getGameAction(key); } catch (Exception e) { }

        if (dead || won) {
            if (key == KEY_NUM5 || a == FIRE) reset();
            return;
        }
        if (a == UP) cy = Math.max(0, cy - 1);
        else if (a == DOWN) cy = Math.min(ROWS - 1, cy + 1);
        else if (a == LEFT) cx = Math.max(0, cx - 1);
        else if (a == RIGHT) cx = Math.min(COLS - 1, cx + 1);
        else if (key == KEY_NUM5 || a == FIRE) reveal();
        else if (key == KEY_NUM1) toggleFlag();
    }

    protected void paint(Graphics g) {
        int w = getWidth(), h = getHeight();
        int fontH = g.getFont().getHeight();
        int top = fontH + 12, bottom = fontH + 12;
        int cell = Math.min((w - 8) / COLS, (h - top - bottom) / ROWS);
        if (cell < 8) cell = 8;
        int ox = (w - cell * COLS) / 2;
        int oy = top + (h - top - bottom - cell * ROWS) / 2;

        g.setColor(0x0B1016); g.fillRect(0, 0, w, h);
        g.setColor(0x1E2A38);
        g.fillRect(ox, oy, cell * COLS, cell * ROWS);

        for (int y = 0; y < ROWS; y++) {
            for (int x = 0; x < COLS; x++) {
                int px = ox + x * cell, py = oy + y * cell;
                if (open[y][x]) {
                    g.setColor(0x141C26);
                    g.fillRect(px + 1, py + 1, cell - 2, cell - 2);
                    if (mine[y][x]) {
                        g.setColor(0xFF6B6B);
                        g.fillArc(px + cell / 4, py + cell / 4, cell / 2, cell / 2, 0, 360);
                    } else if (near[y][x] > 0) {
                        g.setColor(numColor(near[y][x]));
                        g.drawString(String.valueOf(near[y][x]),
                            px + cell / 2, py + (cell - fontH) / 2, Graphics.TOP | Graphics.HCENTER);
                    }
                } else {
                    g.setColor(0x2A3A4D);
                    g.fillRect(px + 1, py + 1, cell - 2, cell - 2);
                    if (flag[y][x]) {
                        g.setColor(0xF2C14E);
                        int s = Math.max(3, cell / 3);
                        g.fillRect(px + cell / 2 - s / 2, py + cell / 2 - s / 2, s, s);
                    }
                }
            }
        }

        // 光标
        g.setColor(0x7BE4FF);
        g.drawRect(ox + cx * cell, oy + cy * cell, cell - 1, cell - 1);

        g.setColor(0xE6EDF3);
        g.drawString("扫雷  " + (MINES - flagCount) + " 雷  " + elapsed / 1000 + "s", w / 2, 6,
            Graphics.TOP | Graphics.HCENTER);

        int msgY = Math.max(0, h - fontH - 4);
        g.setColor(dead ? 0xFF6B6B : won ? 0x4FD1C5 : 0x99A7B5);
        if (dead) g.drawString("踩雷了 · 5 重来", w / 2, msgY, Graphics.TOP | Graphics.HCENTER);
        else if (won) g.drawString("扫清了 · 5 再来一局", w / 2, msgY, Graphics.TOP | Graphics.HCENTER);
        else g.drawString("5 翻开 · 1 插旗", w / 2, msgY, Graphics.TOP | Graphics.HCENTER);
    }

    private int numColor(int n) {
        switch (n) {
            case 1: return 0x7BE4FF;
            case 2: return 0x4FD1C5;
            case 3: return 0xF2C14E;
            case 4: return 0xC792EA;
            default: return 0xFF6B6B;
        }
    }
}
