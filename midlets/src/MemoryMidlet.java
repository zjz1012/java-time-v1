import javax.microedition.midlet.MIDlet;
import javax.microedition.lcdui.*;
import java.util.Random;

/** 记忆翻牌 —— 自研 J2ME demo，零第三方素材，可自由分发 */
public class MemoryMidlet extends MIDlet {
    private Display display;
    private MemoryCanvas canvas;

    public MemoryMidlet() {
        display = Display.getDisplay(this);
        canvas = new MemoryCanvas(this);
    }
    public void startApp() { display.setCurrent(canvas); canvas.repaint(); }
    public void pauseApp() { }
    public void destroyApp(boolean u) { canvas.stop(); }
    /** 供内部 Canvas 请求退出（notifyDestroyed 是 protected，无法从 Canvas 直接调用） */
    void quit() { notifyDestroyed(); }
}

class MemoryCanvas extends Canvas implements CommandListener, Runnable {
    private static final int N = 4, PAIRS = N * N / 2;
    private MemoryMidlet host;
    private int[] val = new int[N * N];
    private boolean[] open = new boolean[N * N];
    private boolean[] done = new boolean[N * N];
    private int cursor, first, second, moves, matched;
    private boolean busy, running;
    private Command exitCmd = new Command("退出", Command.EXIT, 1);
    private long hideAt;

    MemoryCanvas(MemoryMidlet host) {
        this.host = host;
        addCommand(exitCmd);
        setCommandListener(this);
        reset();
        running = true;
        new Thread(this).start();
    }

    public void commandAction(Command c, Displayable d) {
        if (c == exitCmd) host.quit();
    }

    void stop() { running = false; }

    private void reset() {
        Random r = new Random();
        for (int i = 0; i < N * N; i++) val[i] = (i / 2) + 1;
        for (int i = val.length - 1; i > 0; i--) {
            int j = Math.abs(r.nextInt()) % (i + 1);
            int t = val[i]; val[i] = val[j]; val[j] = t;
        }
        for (int i = 0; i < val.length; i++) { open[i] = false; done[i] = false; }
        cursor = 0; first = -1; second = -1; moves = 0; matched = 0; busy = false;
    }

    public void run() {
        while (running) {
            if (busy && System.currentTimeMillis() >= hideAt) {
                busy = false;
                if (val[first] != val[second]) { open[first] = false; open[second] = false; }
                first = -1; second = -1;
                repaint();
            }
            try { Thread.sleep(90); } catch (InterruptedException e) { }
        }
    }

    protected void paint(Graphics g) {
        int w = getWidth(), h = getHeight();
        g.setColor(0x0B1016); g.fillRect(0, 0, w, h);

        int pad = 10;
        int size = (Math.min(w - 16, h - 70) - pad * (N - 1)) / N;
        int ox = (w - size * N - pad * (N - 1)) / 2;
        int oy = 36;

        for (int i = 0; i < N * N; i++) {
            int cx = ox + (i % N) * (size + pad);
            int cy = oy + (i / N) * (size + pad);
            boolean face = done[i] || open[i];
            if (done[i]) g.setColor(0x1F4B48);
            else g.setColor(face ? 0x2A3A4C : 0x14202C);
            g.fillRect(cx, cy, size, size);
            if (face) {
                g.setColor(done[i] ? 0x4FD1C5 : 0xE6EDF3);
                g.drawString(String.valueOf(val[i]), cx + size / 2, cy + size / 2 - 4,
                        Graphics.TOP | Graphics.HCENTER);
            }
            if (i == cursor) {
                g.setColor(0x7BE4FF);
                g.drawRect(cx - 2, cy - 2, size + 3, size + 3);
            }
        }

        g.setColor(0xE6EDF3);
        g.drawString("记忆翻牌  " + moves + " 步", w / 2, 8, Graphics.TOP | Graphics.HCENTER);
        if (matched == PAIRS) {
            g.setColor(0xF2C14E);
            g.drawString("全对！按 5 再来", w / 2, oy + (size + pad) * N + 4, Graphics.TOP | Graphics.HCENTER);
        }
    }

    private void move(int dc, int dr) {
        if (busy) return;
        int x = (cursor % N + dc + N) % N;
        int y = (cursor / N + dr + N) % N;
        cursor = y * N + x;
        repaint();
    }

    private void flip() {
        if (busy) return;
        if (matched == PAIRS) { reset(); repaint(); return; }
        if (done[cursor] || open[cursor]) return;
        open[cursor] = true;
        if (first < 0) { first = cursor; repaint(); return; }
        second = cursor;
        moves++;
        if (val[first] == val[second]) {
            done[first] = true; done[second] = true; matched++;
            first = -1; second = -1;
        } else {
            busy = true;
            hideAt = System.currentTimeMillis() + 700;
        }
        repaint();
    }

    protected void keyPressed(int key) {
        int a = 0;
        try { a = getGameAction(key); } catch (Exception e) { }
        if (a == UP || key == KEY_NUM2) move(0, -1);
        else if (a == DOWN || key == KEY_NUM8) move(0, 1);
        else if (a == LEFT || key == KEY_NUM4) move(-1, 0);
        else if (a == RIGHT || key == KEY_NUM6) move(1, 0);
        else if (key == KEY_NUM5 || a == FIRE) flip();
    }
}
