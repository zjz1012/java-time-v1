import javax.microedition.midlet.MIDlet;
import javax.microedition.lcdui.*;
import java.util.Random;

/**
 * 猜数字 —— 自研 Canvas 版，替代原「猜数字」第三方包。
 *
 * 原包的主界面是 Form + ChoiceGroup，而内核的 Form 渲染层整层是空桩
 * （见 host.html 里「三、给内核缺失的 native 补桩」那段注释），画不出来也点不了。
 * 自研版把所有界面放进 Canvas 自己画，绕开这层缺失。
 *
 * 玩法：1~100，上下微调、左右大幅调整，按 5 提交。
 */
public class GuessNumberMidlet extends MIDlet {
    private Display display;
    private GuessCanvas canvas;

    public GuessNumberMidlet() {
        display = Display.getDisplay(this);
        canvas = new GuessCanvas();
    }

    public void startApp() { canvas.start(); display.setCurrent(canvas); }
    public void pauseApp() { canvas.pause(); }
    public void destroyApp(boolean u) { canvas.stop(); }
}

class GuessCanvas extends Canvas implements Runnable {
    private Random rnd = new Random();
    private int secret, guess, tries, best;
    private int lastHint; // 0 无、-1 太大、1 太小
    private boolean won, running;

    GuessCanvas() { reset(); }

    private void reset() {
        secret = 1 + Math.abs(rnd.nextInt()) % 100;
        guess = 50;
        tries = 0;
        lastHint = 0;
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
            try { Thread.sleep(50); } catch (InterruptedException e) { }
        }
    }

    private void submit() {
        if (won) { reset(); return; }
        tries++;
        if (guess == secret) {
            won = true;
            if (best == 0 || tries < best) best = tries;
        } else if (guess > secret) {
            lastHint = -1;
        } else {
            lastHint = 1;
        }
    }

    protected void paint(Graphics g) {
        int w = getWidth(), h = getHeight();
        int fontH = g.getFont().getHeight();
        g.setColor(0x0B1016); g.fillRect(0, 0, w, h);

        g.setColor(0x7BE4FF);
        g.drawString("猜数字", w / 2, 8, Graphics.TOP | Graphics.HCENTER);

        // 大号数字用矩形拼出来太重，这里靠字号层级 + 留白拉开视觉重心。
        g.setColor(won ? 0x4FD1C5 : 0xF2C14E);
        g.drawString(String.valueOf(guess), w / 2, h / 2 - fontH * 2, Graphics.TOP | Graphics.HCENTER);

        g.setColor(0x99A7B5);
        g.drawString("范围 1 ~ 100", w / 2, h / 2, Graphics.TOP | Graphics.HCENTER);

        g.setColor(0xE6EDF3);
        g.drawString("已猜 " + tries + " 次", w / 2, h / 2 + fontH + 4, Graphics.TOP | Graphics.HCENTER);

        if (lastHint != 0 && !won) {
            g.setColor(lastHint == -1 ? 0xFF6B6B : 0x7BE4FF);
            g.drawString(lastHint == -1 ? "太大了" : "太小了", w / 2, h / 2 + fontH * 2 + 8,
                Graphics.TOP | Graphics.HCENTER);
        }
        if (won) {
            g.setColor(0x4FD1C5);
            g.drawString("猜中了！", w / 2, h / 2 + fontH * 2 + 8, Graphics.TOP | Graphics.HCENTER);
            if (best > 0) {
                g.setColor(0x99A7B5);
                g.drawString("最好成绩 " + best + " 次", w / 2, h / 2 + fontH * 3 + 12,
                    Graphics.TOP | Graphics.HCENTER);
            }
        }

        // 数值调节条：让「还能往哪调」有空间感，而不是只有一个数字。
        int barY = h - fontH * 4;
        int barW = w - 40;
        g.setColor(0x1E2A38);
        g.fillRect(20, barY, barW, 6);
        g.setColor(0x7BE4FF);
        g.fillRect(20, barY, barW * guess / 100, 6);

        int msgY = Math.max(0, h - fontH - 6);
        g.setColor(0xE6EDF3);
        g.drawString(won ? "5 再玩一局" : "上下 ±1 · 左右 ±10 · 5 提交", w / 2, msgY,
            Graphics.TOP | Graphics.HCENTER);
    }

    protected void keyPressed(int key) {
        int a = 0;
        try { a = getGameAction(key); } catch (Exception e) { }

        if (won) {
            if (key == KEY_NUM5 || a == FIRE) reset();
            return;
        }
        if (a == UP) guess = Math.max(1, guess - 1);
        else if (a == DOWN) guess = Math.min(100, guess + 1);
        else if (a == LEFT) guess = Math.max(1, guess - 10);
        else if (a == RIGHT) guess = Math.min(100, guess + 10);
        else if (key == KEY_NUM5 || a == FIRE) submit();
    }
}
