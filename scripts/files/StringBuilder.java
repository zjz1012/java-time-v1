package java.lang;

/**
 * 最小 StringBuilder 实现 —— 构建适配用。
 *
 * 上游 CLDC 类库是 Java 1.3 时代的产物，只有 StringBuffer
 * （1.3 的 javac 对字符串拼接生成 StringBuffer）。
 * 现代 javac 一律生成 StringBuilder，故在此补一个同义类，
 * 内部全权委托给 StringBuffer，语义完全一致（仅少一层同步）。
 */
public final class StringBuilder {

    private final StringBuffer buf;

    public StringBuilder() {
        buf = new StringBuffer();
    }

    public StringBuilder(int capacity) {
        buf = new StringBuffer(capacity);
    }

    public StringBuilder(String str) {
        buf = new StringBuffer(str);
    }

    public StringBuilder append(Object obj) {
        buf.append(obj);
        return this;
    }

    public StringBuilder append(String str) {
        buf.append(str);
        return this;
    }

    public StringBuilder append(StringBuffer sb) {
        buf.append(sb == null ? "null" : sb.toString());
        return this;
    }

    public StringBuilder append(char c) {
        buf.append(c);
        return this;
    }

    public StringBuilder append(char[] str) {
        buf.append(str);
        return this;
    }

    public StringBuilder append(char[] str, int offset, int len) {
        buf.append(str, offset, len);
        return this;
    }

    public StringBuilder append(boolean b) {
        buf.append(b);
        return this;
    }

    public StringBuilder append(int i) {
        buf.append(i);
        return this;
    }

    public StringBuilder append(long l) {
        buf.append(l);
        return this;
    }

    public StringBuilder append(float f) {
        buf.append(f);
        return this;
    }

    public StringBuilder append(double d) {
        buf.append(d);
        return this;
    }

    public int length() {
        return buf.length();
    }

    public int capacity() {
        return buf.capacity();
    }

    public char charAt(int index) {
        return buf.charAt(index);
    }

    public void setCharAt(int index, char ch) {
        buf.setCharAt(index, ch);
    }

    public StringBuilder deleteCharAt(int index) {
        buf.deleteCharAt(index);
        return this;
    }

    public StringBuilder reverse() {
        buf.reverse();
        return this;
    }

    public String toString() {
        return buf.toString();
    }
}
