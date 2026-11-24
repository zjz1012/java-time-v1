import javax.microedition.midlet.MIDlet;
import javax.microedition.lcdui.*;
import java.util.Random;

/**
 * 一路向前 —— 自研 Canvas 版，替代原「一路向前」第三方包（原包主界面依赖 Form 渲染）。
 *
 * 横向跑酷：角色固定在左侧三车道之一，障碍从右向左冲来，躲得越久分越高、越快。
 * 方向键换道（上下），不需要按前进键 —— 名字就是这么来的。
 */
public class RunnerDashMidlet extends MIDlet {
    private Display display;
    private RunnerCanvas canvas;

    public RunnerDashMidlet() {
        display = Display.getDisplay(this);
        canvas = new RunnerCanvas();
    }

    public void startApp() { canvas.start(); display.setCurrent(canvas); }
    public void pauseApp() { canvas.pause(); }
    public void destroyApp(boolean u) { canvas.stop(); }
}

class RunnerCanvas extends Canvas implements Runnable {
    private static final int SLOTS = 6;

    private final int[] obsX = new int[SLOTS];
    private final int[] obsLane = new int[SLOTS];
    private final boolean[] obsOn = new boolean[SLOTS];

    private int lane;           // 0 上 / 1 中 / 2 下
    private int speed, spawnGap, dist, best;
    private boolean started, over, running;
    private long tick;
    private Random rnd = new Random();

    RunnerCanvas() { reset(); }

    private void reset() {
        for (int i = 0; i < SLOTS; i++) obsOn[i] = false;
        lane = 1;
        speed = 4;
        spawnGap = 40;
        dist = 0;
        tick = 0;
        started = false;
        over = false;
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
            if (started && !over) step();
            repaint();
            try { Thread.sleep(33); } catch (InterruptedException e) { }
        }
    }

    // ---------------------------------------------------------------- 布局

    private int laneY(int i, int h) {
        int top = 44, bottom = h - 28;
        int band = (bottom - top) / 3;
        return top + i * band + band / 2;
    }

    private void step() {
        tick++;
        dist += speed;
        if (dist / 200 > speed - 4 && speed < 16) speed++;

        // 生成：间隔随速度缩短，但保底留出反应距离
        if (--spawnGap <= 0) {
            spawnGap = Math.max(16, 42 - speed);
            for (int i = 0; i < SLOTS; i++) if (!obsOn[i]) {
                obsOn[i] = true;
                obsX[i] = getWidth() + 10;
                obsLane[i] = Math.abs(rnd.nextInt()) % 3;
                break;
            }
        }

        int playerX = 24, w = getWidth();
        int py = laneY(lane, getHeight());
        int obsW = Math.max(14, w / 12);

        for (int i = 0; i < SLOTS; i++) {
            if (!obsOn[i]) continue;
            obsX[i] -= speed;
            if (obsX[i] + obsW < 0) { obsOn[i] = false; continue; }
            // 碰撞：同一车道且水平重叠
            if (obsLane[i] == lane && obsX[i] <= playerX + 18 && obsX[i] + obsW >= playerX) {
                over = true;
                if (dist > best) best = dist;
                return;
            }
        }
    }

    protected void keyPressed(int key) {
        int a = 0;
        try { a = getGameAction(key); } catch (Exception e) { }

        if (over) {
            if (key == KEY_NUM5 || a == FIRE) reset();
            return;
        }
        if (!started) {
            if (key == KEY_NUM5 || a == FIRE) started = true;
            return;
        }
        if (a == UP) lane = Math.max(0, lane - 1);
        else if (a == DOWN) lane = Math.min(2, lane + 1);
    }

    protected void keyRepeated(int key) { keyPressed(key); }

    protected void paint(Graphics g) {
        int w = getWidth(), h = getHeight();
        int fontH = g.getFont().getHeight();

        g.setColor(0x0B1016); g.fillRect(0, 0, w, h);

        // 三条车道分隔线，跟着速度滚动 —— 固定线会让人以为角色没动
        g.setColor(0x1E2A38);
        int top = 44, bottom = h - 28;
        int band = (bottom - top) / 3;
        for (int i = 1; i < 3; i++) {
            int y = top + i * band;
            for (int x = -(int) (dist % 24); x < w; x += 24) g.fillRect(x, y, 12, 2);
        }

        int obsW = Math.max(14, w / 12);
        g.setColor(0xFF6B6B);
        for (int i = 0; i < SLOTS; i++) {
            if (!obsOn[i]) continue;
            int y = laneY(obsLane[i], h);
            g.fillRect(obsX[i], y - 10, obsW, 20);
        }

        // 角色
        int py = laneY(lane, h);
        g.setColor(0x7BE4FF);
        g.fillRect(24, py - 12, 18, 24);
        g.setColor(0x0B1016);
        g.fillRect(34, py - 6, 4, 4);

        g.setColor(0xE6EDF3);
        g.drawString("一路向前", 10, 6, Graphics.TOP | Graphics.LEFT);
        g.setColor(0x99A7B5);
        g.drawString(String.valueOf(dist / 10) + " m", w - 10, 6, Graphics.TOP | Graphics.RIGHT);

        int msgY = Math.max(0, h - fontH - 4);
        if (!started) {
            g.setColor(0xE6EDF3);
            g.drawString("5 开始 · 上下换道", w / 2, msgY, Graphics.TOP | Graphics.HCENTER);
        } else if (over) {
            g.setColor(0xFF6B6B);
            g.drawString("撞上了 · " + (dist / 10) + " m · 5 重来", w / 2, msgY,
                Graphics.TOP | Graphics.HCENTER);
        } else {
            g.setColor(0x4FD1C5);
            g.drawString("速度 " + speed, w / 2, msgY, Graphics.TOP | Graphics.HCENTER);
        }
    }
}
