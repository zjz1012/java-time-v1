import javax.microedition.midlet.MIDlet;
import javax.microedition.lcdui.*;
import java.util.Random;

/**
 * 小蜜蜂 —— 自研 Canvas 版，替代原「小蜜蜂」第三方包（原包主界面依赖 Form 渲染）。
 *
 * 竖版射击：底部炮台左右移动、按 5 开火，敌群整体左右扫、碰边下压，清空进下一波。
 *
 * ★ 不用浮点：CLDC 1.1 有 float，但这类整数像素游戏用定点数（乘 10 存速度）更稳定，
 *   也避免了「不同设备浮点差异导致难度不一致」这种查不出来的问题。
 */
public class BeeShooterMidlet extends MIDlet {
    private Display display;
    private BeeCanvas canvas;

    public BeeShooterMidlet() {
        display = Display.getDisplay(this);
        canvas = new BeeCanvas();
    }

    public void startApp() { canvas.start(); display.setCurrent(canvas); }
    public void pauseApp() { canvas.pause(); }
    public void destroyApp(boolean u) { canvas.stop(); }
}

class BeeCanvas extends Canvas implements Runnable {
    private static final int COLS = 5, ROWS = 4;
    private static final int BULLETS = 3, ENEMY_SHOTS = 6;

    private final boolean[] alive = new boolean[COLS * ROWS];
    private final int[] bulletX = new int[BULLETS];
    private final int[] bulletY = new int[BULLETS];
    private final boolean[] bulletOn = new boolean[BULLETS];
    private final int[] shotX = new int[ENEMY_SHOTS];
    private final int[] shotY = new int[ENEMY_SHOTS];
    private final boolean[] shotOn = new boolean[ENEMY_SHOTS];

    private int playerX, playerY;
    private int swarmX, swarmY, swarmDir = 1;
    private int wave = 1, score, lives = 3;
    private int shootCooldown, enemyCooldown, tick;
    private boolean started, over, running;
    private Random rnd = new Random();

    BeeCanvas() { reset(); }

    private void reset() {
        for (int i = 0; i < alive.length; i++) alive[i] = true;
        for (int i = 0; i < BULLETS; i++) bulletOn[i] = false;
        for (int i = 0; i < ENEMY_SHOTS; i++) shotOn[i] = false;
        swarmX = 0; swarmY = 0; swarmDir = 1;
        wave = 1; score = 0; lives = 3;
        shootCooldown = 0; enemyCooldown = 0; tick = 0;
        started = false; over = false;
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

    // ---------------------------------------------------------------- 尺寸

    private int cellW, cellH, gridLeft, gridTop, playerW;

    private void measure() {
        cellW = Math.max(12, Math.min(getWidth() / 7, 26));
        cellH = Math.max(10, cellW - 4);
        gridLeft = (getWidth() - cellW * COLS) / 2;
        gridTop = getHeight() / 6;
        playerW = Math.max(14, cellW);
        if (playerY == 0) playerY = getHeight() - 42;
        if (playerX == 0) playerX = getWidth() / 2 - playerW / 2;
    }

    private int beeX(int i) { return gridLeft + swarmX + (i % COLS) * cellW; }
    private int beeY(int i) { return gridTop + swarmY + (i / COLS) * cellH; }

    // ---------------------------------------------------------------- 每帧

    private void step() {
        measure();
        tick++;

        // 敌群左右扫：每 2 帧 1 像素，碰边下压并反向
        if (tick % 2 == 0) {
            swarmX += swarmDir;
            int rightEdge = gridLeft + swarmX + cellW * COLS;
            if (swarmX > 0 || rightEdge > getWidth()) {
                swarmDir = -swarmDir;
                swarmY += Math.max(4, cellH / 2);
                swarmX += swarmDir * 2;
            }
        }
        // 敌群压到底线就算输
        for (int i = 0; i < alive.length; i++) {
            if (alive[i] && beeY(i) + cellH >= playerY - 6) { over = true; return; }
        }

        // 子弹
        if (shootCooldown > 0) shootCooldown--;
        for (int i = 0; i < BULLETS; i++) if (bulletOn[i]) {
            bulletY[i] -= 7;
            if (bulletY[i] < 0) bulletOn[i] = false;
        }
        if (enemyCooldown > 0) enemyCooldown--;
        if (enemyCooldown == 0) {
            enemyCooldown = Math.max(14, 44 - wave * 4);
            fireEnemyShot();
        }
        for (int i = 0; i < ENEMY_SHOTS; i++) if (shotOn[i]) {
            shotY[i] += 3 + wave / 2;
            if (shotY[i] > getHeight()) shotOn[i] = false;
        }

        collide();
    }

    private void fireEnemyShot() {
        int count = 0;
        for (int i = 0; i < alive.length; i++) if (alive[i]) count++;
        if (count == 0) return;
        int pick = Math.abs(rnd.nextInt()) % count;
        int idx = -1;
        for (int i = 0; i < alive.length; i++) {
            if (!alive[i]) continue;
            if (pick-- == 0) { idx = i; break; }
        }
        if (idx < 0) return;
        for (int i = 0; i < ENEMY_SHOTS; i++) if (!shotOn[i]) {
            shotOn[i] = true;
            shotX[i] = beeX(idx) + cellW / 2;
            shotY[i] = beeY(idx) + cellH;
            return;
        }
    }

    private void collide() {
        for (int b = 0; b < BULLETS; b++) {
            if (!bulletOn[b]) continue;
            for (int i = 0; i < alive.length; i++) {
                if (!alive[i]) continue;
                if (bulletX[b] >= beeX(i) && bulletX[b] <= beeX(i) + cellW
                    && bulletY[b] >= beeY(i) && bulletY[b] <= beeY(i) + cellH) {
                    alive[i] = false;
                    bulletOn[b] = false;
                    score += 10;
                    break;
                }
            }
        }
        int px0 = playerX, px1 = playerX + playerW;
        int py0 = playerY, py1 = playerY + playerW / 2 + 4;
        for (int i = 0; i < ENEMY_SHOTS; i++) {
            if (!shotOn[i]) continue;
            if (shotX[i] >= px0 && shotX[i] <= px1 && shotY[i] >= py0 && shotY[i] <= py1) {
                shotOn[i] = false;
                lives--;
                if (lives <= 0) { over = true; return; }
            }
        }
        // 清空 → 下一波
        boolean any = false;
        for (int i = 0; i < alive.length; i++) if (alive[i]) { any = true; break; }
        if (!any) {
            wave++;
            score += 50;
            for (int i = 0; i < alive.length; i++) alive[i] = true;
            for (int i = 0; i < ENEMY_SHOTS; i++) shotOn[i] = false;
            swarmX = 0; swarmY = 0; swarmDir = 1;
        }
    }

    // ---------------------------------------------------------------- 输入

    protected void keyPressed(int key) {
        int a = 0;
        try { a = getGameAction(key); } catch (Exception e) { }
        measure();

        if (!started) {
            if (key == KEY_NUM5 || a == FIRE) started = true;
            return;
        }
        if (over) {
            if (key == KEY_NUM5 || a == FIRE) reset();
            return;
        }
        if (a == LEFT) playerX = Math.max(2, playerX - Math.max(6, playerW / 2));
        else if (a == RIGHT) playerX = Math.min(getWidth() - playerW - 2, playerX + Math.max(6, playerW / 2));
        else if (key == KEY_NUM5 || a == FIRE) fire();
    }

    private void fire() {
        if (shootCooldown > 0) return;
        shootCooldown = 6;
        for (int i = 0; i < BULLETS; i++) if (!bulletOn[i]) {
            bulletOn[i] = true;
            bulletX[i] = playerX + playerW / 2;
            bulletY[i] = playerY - 2;
            return;
        }
    }

    protected void keyRepeated(int key) { keyPressed(key); }

    // ---------------------------------------------------------------- 绘制

    protected void paint(Graphics g) {
        measure();
        int w = getWidth(), h = getHeight();
        int fontH = g.getFont().getHeight();

        g.setColor(0x0B1016); g.fillRect(0, 0, w, h);

        // 星星背景：省掉图片资源，也顺便让「静止感」消失
        g.setColor(0x1B2635);
        for (int i = 0; i < 24; i++) {
            int sx = (i * 53) % w;
            int sy = (i * 37 + tick / 3) % h;
            g.fillRect(sx, sy, 2, 2);
        }

        for (int i = 0; i < alive.length; i++) {
            if (!alive[i]) continue;
            int x = beeX(i), y = beeY(i);
            g.setColor(0xF2C14E);
            g.fillRect(x + 2, y + 2, cellW - 4, cellH - 6);
            g.setColor(0x0B1016);
            g.fillRect(x + 4, y + 4, 2, 2);
            g.fillRect(x + cellW - 6, y + 4, 2, 2);
            g.setColor(0xF2C14E);
            g.fillRect(x + cellW / 2 - 1, y - 1, 2, 3);
        }

        g.setColor(0x7BE4FF);
        for (int i = 0; i < BULLETS; i++) if (bulletOn[i]) g.fillRect(bulletX[i], bulletY[i], 2, 6);

        g.setColor(0xFF6B6B);
        for (int i = 0; i < ENEMY_SHOTS; i++) if (shotOn[i]) g.fillRect(shotX[i] - 1, shotY[i], 3, 6);

        // 炮台
        g.setColor(0x4FD1C5);
        g.fillRect(playerX, playerY, playerW, 6);
        g.fillRect(playerX + playerW / 2 - 1, playerY - 6, 3, 6);

        g.setColor(0xE6EDF3);
        g.drawString("小蜜蜂  " + score, w / 2, 4, Graphics.TOP | Graphics.HCENTER);
        g.setColor(0x99A7B5);
        g.drawString("第 " + wave + " 波 · 命 " + lives, w / 2, fontH + 8, Graphics.TOP | Graphics.HCENTER);

        int msgY = Math.max(0, h - fontH - 4);
        if (!started) {
            g.setColor(0xE6EDF3);
            g.drawString("5 开始", w / 2, msgY, Graphics.TOP | Graphics.HCENTER);
        } else if (over) {
            g.setColor(0xFF6B6B);
            g.drawString("结束 · 得分 " + score + " · 5 重来", w / 2, msgY, Graphics.TOP | Graphics.HCENTER);
        }
    }
}
