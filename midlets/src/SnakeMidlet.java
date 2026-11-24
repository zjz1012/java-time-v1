import javax.microedition.midlet.MIDlet;
import javax.microedition.lcdui.*;
import java.util.Random;

/** 贪吃蛇 —— 自研 J2ME demo，零第三方素材，可自由分发 */
public class SnakeMidlet extends MIDlet {
    private Display display;
    private SnakeCanvas canvas;

    public SnakeMidlet() {
        display = Display.getDisplay(this);
        canvas = new SnakeCanvas();
    }
    public void startApp() { canvas.start(); display.setCurrent(canvas); }
    public void pauseApp() { canvas.pause(); }
    public void destroyApp(boolean u) { canvas.stop(); }
}

class SnakeCanvas extends Canvas implements Runnable {
    private static final int COLS = 12, ROWS = 16;
    private int cell, ox, oy;
    private int[] sx = new int[COLS * ROWS], sy = new int[COLS * ROWS];
    private int len, dirX, dirY, nextDirX, nextDirY, foodX, foodY, score;
    private boolean running, alive, started;
    private Random rnd = new Random();

    SnakeCanvas() { reset(); }

    private void reset() {
        len = 3; dirX = 1; dirY = 0; nextDirX = 1; nextDirY = 0;
        score = 0; alive = true; started = false;
        for (int i = 0; i < len; i++) { sx[i] = len - 1 - i; sy[i] = ROWS / 2; }
        placeFood();
    }

    private void placeFood() {
        do {
            foodX = Math.abs(rnd.nextInt()) % COLS;
            foodY = Math.abs(rnd.nextInt()) % ROWS;
        } while (occupied(foodX, foodY));
    }

    private boolean occupied(int x, int y) {
        for (int i = 0; i < len; i++) if (sx[i] == x && sy[i] == y) return true;
        return false;
    }

    void start() {
        if (running) return;
        running = true;
        new Thread(this).start();
    }
    void pause() { running = false; }
    void stop() { running = false; }

    private static final int TOP_PAD = 30;    // 顶部标题行
    private static final int BOTTOM_PAD = 40; // 底部提示行：不留就会把字画到画布外被裁

    private void geometry() {
        int w = getWidth(), h = getHeight();
        cell = Math.min(w / COLS, (h - TOP_PAD - BOTTOM_PAD) / ROWS);
        if (cell < 4) cell = 4;
        ox = (w - cell * COLS) / 2;
        oy = TOP_PAD + (h - TOP_PAD - BOTTOM_PAD - cell * ROWS) / 2;
    }

    public void run() {
        while (running) {
            if (started && alive) tick();
            repaint();
            try { Thread.sleep(alive && started ? 170 : 60); } catch (InterruptedException e) { }
        }
    }

    private void tick() {
        if (nextDirX != -dirX || nextDirY != -dirY) { dirX = nextDirX; dirY = nextDirY; }
        int nx = sx[0] + dirX, ny = sy[0] + dirY;
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) { alive = false; return; }
        for (int i = 0; i < len - 1; i++) if (sx[i] == nx && sy[i] == ny) { alive = false; return; }
        for (int i = len; i > 0; i--) { sx[i] = sx[i - 1]; sy[i] = sy[i - 1]; }
        sx[0] = nx; sy[0] = ny;
        if (nx == foodX && ny == foodY) {
            if (len < COLS * ROWS - 1) len++;
            score += 10;
            placeFood();
        }
    }

    protected void paint(Graphics g) {
        geometry();
        int w = getWidth(), h = getHeight();
        g.setColor(0x0B1016); g.fillRect(0, 0, w, h);

        g.setColor(0x1E2A38);
        g.fillRect(ox, oy, cell * COLS, cell * ROWS);

        g.setColor(0xF2C14E);
        g.fillRect(ox + foodX * cell + 2, oy + foodY * cell + 2, cell - 4, cell - 4);

        for (int i = 0; i < len; i++) {
            g.setColor(i == 0 ? 0x7BE4FF : 0x4FD1C5);
            g.fillRect(ox + sx[i] * cell + 1, oy + sy[i] * cell + 1, cell - 2, cell - 2);
        }

        g.setColor(0xE6EDF3);
        g.drawString("贪吃蛇  " + score, w / 2, 8, Graphics.TOP | Graphics.HCENTER);

        // 提示文字放棋盘下方，并在剩余空间里垂直居中；出界时夹回边界内。
        // 曾经直接写 h/2 + cell*ROWS/2 + 6，在 240x320 下算到 y=310、字高 26 ⇒ 越出 320 被裁。
        int boardBottom = oy + cell * ROWS;
        int msgH = g.getFont().getHeight();
        int room = h - boardBottom;
        int msgY = (room >= msgH + 4) ? boardBottom + (room - msgH) / 2 : Math.max(0, h - msgH);
        if (!started) {
            g.setColor(0x99A7B5);
            g.drawString("按 5 或 OK 开始", w / 2, msgY, Graphics.TOP | Graphics.HCENTER);
        } else if (!alive) {
            g.setColor(0xFF6B6B);
            g.drawString("撞了！按 5 重来", w / 2, msgY, Graphics.TOP | Graphics.HCENTER);
        }
    }

    protected void keyPressed(int key) {
        int a = 0;
        try { a = getGameAction(key); } catch (Exception e) { }
        if (a == UP) { nextDirX = 0; nextDirY = -1; }
        else if (a == DOWN) { nextDirX = 0; nextDirY = 1; }
        else if (a == LEFT) { nextDirX = -1; nextDirY = 0; }
        else if (a == RIGHT) { nextDirX = 1; nextDirY = 0; }
        else if (key == KEY_NUM5 || a == FIRE) {
            if (!alive) reset();
            started = true;
        }
    }
}
