// Generates the Android launcher icons and splash images of a Vibe64 Capacitor
// shell from the app's one 1024x1024 icon, on the pinned JDK (no npm image
// tools). Output is deterministic for the same icon and JDK.
//
//   java ShellIcons.java <icon.png> <android res folder>
import java.awt.AlphaComposite;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.Ellipse2D;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Locale;
import javax.imageio.ImageIO;

public class ShellIcons {
  private static final String[] DENSITIES = {"mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"};
  private static final int[] LAUNCHER = {48, 72, 96, 144, 192};
  private static final int[] FOREGROUND = {108, 162, 216, 324, 432};

  public static void main(String[] args) throws IOException {
    if (args.length != 2) throw new IllegalArgumentException("Usage: ShellIcons <icon.png> <res folder>");
    System.setProperty("java.awt.headless", "true");
    BufferedImage source = ImageIO.read(new File(args[0]));
    if (source == null || source.getWidth() != 1024 || source.getHeight() != 1024) {
      throw new IllegalArgumentException("The app icon must be a 1024x1024 PNG.");
    }
    BufferedImage icon = new BufferedImage(1024, 1024, BufferedImage.TYPE_INT_RGB);
    Graphics2D copy = icon.createGraphics();
    copy.drawImage(source, 0, 0, null);
    copy.dispose();
    File res = new File(args[1]);
    Color background = new Color(icon.getRGB(0, 0));
    for (int index = 0; index < DENSITIES.length; index++) {
      File mipmap = new File(res, "mipmap-" + DENSITIES[index]);
      mipmap.mkdirs();
      int size = LAUNCHER[index];
      write(scaled(icon, size), new File(mipmap, "ic_launcher.png"));
      write(round(scaled(icon, size)), new File(mipmap, "ic_launcher_round.png"));
      // Adaptive icons show the inner 72 of 108 units; the whole icon fits there.
      int layer = FOREGROUND[index];
      int inner = Math.round(layer * 72f / 108f);
      BufferedImage foreground = new BufferedImage(layer, layer, BufferedImage.TYPE_INT_ARGB);
      Graphics2D graphics = foreground.createGraphics();
      graphics.drawImage(scaled(icon, inner), (layer - inner) / 2, (layer - inner) / 2, null);
      graphics.dispose();
      write(foreground, new File(mipmap, "ic_launcher_foreground.png"));
    }
    String hex = String.format(Locale.ROOT, "#%02X%02X%02X", background.getRed(), background.getGreen(), background.getBlue());
    File values = new File(res, "values");
    values.mkdirs();
    Files.writeString(new File(values, "ic_launcher_background.xml").toPath(),
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<resources>\n    <color name=\"ic_launcher_background\">" + hex + "</color>\n</resources>\n",
        StandardCharsets.UTF_8);
    // Pre-Android-12 launch screens: the icon centred on its own background colour,
    // at the size of each splash image the template ships.
    File[] folders = res.listFiles((file) -> file.isDirectory() && file.getName().startsWith("drawable"));
    if (folders == null) return;
    java.util.Arrays.sort(folders);
    for (File folder : folders) {
      File splash = new File(folder, "splash.png");
      if (!splash.isFile()) continue;
      BufferedImage existing = ImageIO.read(splash);
      int width = existing.getWidth();
      int height = existing.getHeight();
      BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
      Graphics2D graphics = image.createGraphics();
      graphics.setColor(background);
      graphics.fillRect(0, 0, width, height);
      int size = Math.max(1, Math.min(width, height) / 3);
      graphics.drawImage(round(scaled(icon, size)), (width - size) / 2, (height - size) / 2, null);
      graphics.dispose();
      write(image, splash);
    }
  }

  // High-quality downscale by repeated halving, then one bicubic step.
  private static BufferedImage scaled(BufferedImage image, int size) {
    BufferedImage current = image;
    while (current.getWidth() / 2 >= size) current = resize(current, current.getWidth() / 2);
    return current.getWidth() == size ? current : resize(current, size);
  }

  private static BufferedImage resize(BufferedImage image, int size) {
    BufferedImage result = new BufferedImage(size, size, BufferedImage.TYPE_INT_RGB);
    Graphics2D graphics = result.createGraphics();
    graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
    graphics.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
    graphics.drawImage(image, 0, 0, size, size, null);
    graphics.dispose();
    return result;
  }

  private static BufferedImage round(BufferedImage image) {
    int size = image.getWidth();
    BufferedImage result = new BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB);
    Graphics2D graphics = result.createGraphics();
    graphics.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
    graphics.fill(new Ellipse2D.Float(0, 0, size, size));
    graphics.setComposite(AlphaComposite.SrcIn);
    graphics.drawImage(image, 0, 0, null);
    graphics.dispose();
    return result;
  }

  private static void write(BufferedImage image, File file) throws IOException {
    if (!ImageIO.write(image, "png", file)) throw new IOException("Could not write " + file);
  }
}
