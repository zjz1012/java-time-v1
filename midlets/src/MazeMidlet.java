import javax.microedition.midlet.MIDlet;
import javax.microedition.lcdui.*;
import java.util.Random;

/**
 * 迷宫 —— 自研 Canvas 版，替代原「迷宫」第三方包（原包主界面依赖 Form 渲染）。
 *
 * 生成用经典的深度优先回溯：从左上角出发，每次随机挑一个「隔一格」的未访问邻居，
 * 打通中间的墙再走过去。这样长走廊多、看起来像迷宫，而不是随机撒墙那种满是死胡同的噪声。
 *
 * ★ 递归改成显式栈：CLDC 的栈很小，且迷宫尺寸一变就可能爆栈 —— 这类崩溃在
 *   真机上只表现为「点了没反应」，很难查。
 */
public class MazeMidlet extends MIDlet {
    private Display display;
    private MazeCanvas canvas;

    public MazeMidlet() {
        display = Display.getDisplay(this);
        canvas = new MazeCanvas();
    }

    public void startApp() { canvas.start(); display.setCurrent(canvas); }
    public void pauseApp() { canvas.pause(); }
    public void destroyApp(boolean u) { canvas.stop(); }
}

class MazeCanvas extends Canvas implements Runnable {
    /** 8×8 个格子 ⇒ 17×17 的墙格网格。 */
    private static final int CELLS = 8;
    private static final int N = CELLS * 2 + 1;

    private final boolean[][] wall = new boolean[N][N];
    private int px = 1, py = 1;
    private int steps, cleared;
    private boolean won, running;
    private Random rnd = new Random();

    MazeCanvas() { generate(); }

    private void generate() {
        for (int y = 0; y < N; y++) for (int x = 0; x < N; x++) wall[y][x] = true;

        int[] stackX = new int[CELLS * CELLS + 1];
        int[] stackY = new int[CELLS * CELLS + 1];
        int sp = 0;
        wall[1][1] = false;
        stackX[0] = 1; stackY[0] = 1;

        int[] dx = {2, -2, 0, 0};
        int[] dy = {0, 0, 2, -2};
        int[] order = new int[4];

        while (sp >= 0) {
            int x = stackX[sp], y = stackY[sp];
            // 收集可走的邻居，再随机挑一个（避免用 List，少一个依赖）
            int count = 0;
            for (int i = 0; i < 4; i++) {
                int nx = x + dx[i], ny = y + dy[i];
                if (nx > 0 && ny > 0 && nx < N - 1 && ny < N - 1 && wall[ny][nx]) order[count++] = i;
            }
            if (count == 0) { sp--; continue; }
            int pick = order[Math.abs(rnd.nextInt()) % count];
            int nx = x + dx[pick], ny = y + dy[pick];
            wall[(y + ny) / 2][(x + nx) / 2] = false;
            wall[ny][nx] = false;
            sp++;
            stackX[sp] = nx; stackY[sp] = ny;
        }

        px = 1; py = 1;
        steps = 0;
        won = false;
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
            try { Thread.sleep(60); } catch (InterruptedException e) { }
        }
    }

    /** 一格一步，撞墙不动；到右下角算通关。 */
    private void move(int dx, int dy) {
        if (won) return;
        int nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) return;
        if (wall[ny][nx]) return;
        px = nx; py = ny;
        steps++;
        if (px == N - 2 && py == N - 2) {
            won = true;
            cleared++;
        }
    }

    protected void keyPressed(int key) {
        int a = 0;
        try { a = getGameAction(key); } catch (Exception e) { }

        if (won) {
            if (key == KEY_NUM5 || a == FIRE) generate();
            return;
        }
        if (a == UP) move(0, -1);
        else if (a == DOWN) move(0, 1);
        else if (a == LEFT) move(-1, 0);
        else if (a == RIGHT) move(1, 0);
    }

    protected void paint(Graphics g) {
        int w = getWidth(), h = getHeight();
        int fontH = g.getFont().getHeight();
        int top = fontH + 12, bottom = fontH + 10;
        int cell = Math.min((w - 8) / N, (h - top - bottom) / N);
        if (cell < 3) cell = 3;
        int ox = (w - cell * N) / 2;
        int oy = top + (h - top - bottom - cell * N) / 2;

        g.setColor(0x0B1016); g.fillRect(0, 0, w, h);

        g.setColor(0x1E2A38);
        for (int y = 0; y < N; y++) for (int x = 0; x < N; x++) {
            if (wall[y][x]) g.fillRect(ox + x * cell, oy + y * cell, cell, cell);
        }

        // 出口
        g.setColor(0x4FD1C5);
        g.fillRect(ox + (N - 2) * cell, oy + (N - 2) * cell, cell, cell);

        int inset = Math.max(1, cell / 4);
        g.setColor(0xF2C14E);
        g.fillRect(ox + px * cell + inset, oy + py * cell + inset,
            Math.max(2, cell - inset * 2), Math.max(2, cell - inset * 2));

        g.setColor(0xE6EDF3);
        g.drawString("迷宫  步数 " + steps, w / 2, 6, Graphics.TOP | Graphics.HCENTER);

        int msgY = Math.max(0, h - fontH - 4);
        g.setColor(won ? 0x4FD1C5 : 0x99A7B5);
        if (won) g.drawString("出来了！5 换一座 · 已过 " + cleared, w / 2, msgY, Graphics.TOP | Graphics.HCENTER);
        else g.drawString("方向键走，到右下角", w / 2, msgY, Graphics.TOP | Graphics.HCENTER);
    }
}
