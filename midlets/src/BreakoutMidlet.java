import javax.microedition.midlet.MIDlet;
import javax.microedition.lcdui.*;

/** 打砖块 —— 自研 J2ME demo，零第三方素材，可自由分发 */
public class BreakoutMidlet extends MIDlet {
    private Display display;
    private BreakoutCanvas canvas;

    public BreakoutMidlet() {
        display = Display.getDisplay(this);
        canvas = new BreakoutCanvas();
    }
    public void startApp() { canvas.start(); display.setCurrent(canvas); }
    public void pauseApp() { canvas.pause(); }
    public void destroyApp(boolean u) { canvas.stop(); }
}

class BreakoutCanvas extends Canvas implements Runnable {
    private static final int COLS = 6, ROWS = 4, TOP = 34, BW = 34, BH = 13;
    private boolean[] brick = new boolean[COLS * ROWS];
    private int padX, padW = 46, padH = 8, ballX, ballY, vx, vy, lives, score;
    private boolean running, alive, started;
    private boolean left, right;

    BreakoutCanvas() { reset(); }

    private void reset() {
        for (int i = 0; i < brick.length; i++) brick[i] = true;
        score = 0; lives = 3; started = false; alive = true;
        launch();
    }

    private void launch() {
        padX = (getWidth() - padW) / 2;
        ballX = getWidth() / 2; ballY = getHeight() - 60;
        vx = 2; vy = -3;
    }

    void start() { if (!running) { running = true; new Thread(this).start(); } }
    void pause() { running = false; }
    void stop() { running = false; }

    public void run() {
        while (running) {
            if (started && alive) tick();
            repaint();
            try { Thread.sleep(started && alive ? 22 : 70); } catch (InterruptedException e) { }
        }
    }

    private int aliveBricks() {
        int n = 0;
        for (int i = 0; i < brick.length; i++) if (brick[i]) n++;
        return n;
    }

    private void tick() {
        int w = getWidth(), h = getHeight();
        if (left) padX -= 4;
        if (right) padX += 4;
        if (padX < 0) padX = 0;
        if (padX > w - padW) padX = w - padW;

        ballX += vx; ballY += vy;

        if (ballX < 4) { ballX = 4; vx = -vx; }
        if (ballX > w - 4) { ballX = w - 4; vx = -vx; }
        if (ballY < 4) { ballY = 4; vy = -vy; }

        int padY = h - 34;
        if (ballY > padY - 4 && ballY < padY + padH && ballX > padX - 4 && ballX < padX + padW + 4 && vy > 0) {
            ballY = padY - 4;
            vy = -vy;
            int off = (ballX - (padX + padW / 2)) / 6;
            vx += off;
            if (vx > 4) vx = 4;
            if (vx < -4) vx = -4;
        }

        int gx = 4, gy = getWidth() - 4;
        for (int r = 0; r < ROWS; r++) {
            for (int c = 0; c < COLS; c++) {
                int idx = r * COLS + c;
                if (!brick[idx]) continue;
                int bx = c * (BW + 2) + (w - COLS * (BW + 2)) / 2;
                int by = TOP + r * (BH + 3);
                if (ballX > bx - 3 && ballX < bx + BW + 3 && ballY > by - 3 && ballY < by + BH + 3) {
                    brick[idx] = false;
                    score += 5;
                    vy = -vy;
                }
            }
        }

        if (aliveBricks() == 0) { reset(); started = true; return; }

        if (ballY > h) {
            lives--;
            if (lives <= 0) { alive = false; }
            else launch();
        }
    }

    protected void paint(Graphics g) {
        int w = getWidth(), h = getHeight();
        g.setColor(0x0B1016); g.fillRect(0, 0, w, h);

        for (int r = 0; r < ROWS; r++) {
            for (int c = 0; c < COLS; c++) {
                if (!brick[r * COLS + c]) continue;
                int bx = c * (BW + 2) + (w - COLS * (BW + 2)) / 2;
                int by = TOP + r * (BH + 3);
                g.setColor(r % 2 == 0 ? 0x4FD1C5 : 0xF2C14E);
                g.fillRect(bx, by, BW, BH);
            }
        }

        g.setColor(0x7BE4FF);
        g.fillRect(padX, h - 34, padW, padH);

        g.setColor(0xFFFFFF);
        g.fillArc(ballX - 4, ballY - 4, 8, 8, 0, 360);

        g.setColor(0xE6EDF3);
        g.drawString("打砖块  " + score + "   x" + lives, w / 2, 8, Graphics.TOP | Graphics.HCENTER);

        if (!started) {
            g.setColor(0x99A7B5);
            g.drawString("按 5 开始", w / 2, h / 2, Graphics.TOP | Graphics.HCENTER);
        } else if (!alive) {
            g.setColor(0xFF6B6B);
            g.drawString("Game Over 按 5 重来", w / 2, h / 2, Graphics.TOP | Graphics.HCENTER);
        }
    }

    protected void keyPressed(int key) {
        int a = 0;
        try { a = getGameAction(key); } catch (Exception e) { }
        if (a == LEFT || key == KEY_NUM4) left = true;
        else if (a == RIGHT || key == KEY_NUM6) right = true;
        else if (key == KEY_NUM5 || a == FIRE) {
            if (!alive) reset();
            started = true;
        }
    }

    protected void keyReleased(int key) {
        int a = 0;
        try { a = getGameAction(key); } catch (Exception e) { }
        if (a == LEFT || key == KEY_NUM4) left = false;
        else if (a == RIGHT || key == KEY_NUM6) right = false;
    }
}
