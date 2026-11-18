package cn.toside.music.mobile.utils;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Rect;
import android.net.Uri;
import android.net.wifi.WifiInfo;
import android.content.pm.PackageManager;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Log;
import android.view.Window;
import android.view.WindowManager;

import androidx.core.app.LocaleManagerCompat;
import androidx.core.content.FileProvider;
import androidx.core.os.LocaleListCompat;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.WritableNativeArray;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;
import java.util.Objects;

import org.jaudiotagger.audio.AudioFile;
import org.jaudiotagger.audio.AudioFileIO;
import org.jaudiotagger.tag.FieldKey;
import org.jaudiotagger.tag.Tag;
import org.jaudiotagger.tag.images.Artwork;
import org.jaudiotagger.tag.images.ArtworkFactory;

public class UtilsModule extends ReactContextBaseJavaModule {
  private final ReactApplicationContext reactContext;

  private int listenerCount = 0;

  UtilsEvent utilsEvent;

  UtilsModule(ReactApplicationContext reactContext) {
    super(reactContext);
    this.reactContext = reactContext;
    utilsEvent = new UtilsEvent(reactContext);
    registerScreenBroadcastReceiver();
  }

  @Override
  public String getName() {
    return "UtilsModule";
  }

  @ReactMethod
  public void addListener(String eventName) {
    if (listenerCount == 0) {
      // Set up any upstream listeners or background tasks as necessary
    }

    listenerCount += 1;
  }

  @ReactMethod
  public void removeListeners(Integer count) {
    listenerCount -= count;
    if (listenerCount == 0) {
      // Remove upstream listeners, stop unnecessary background tasks
    }
  }

  // A11-008：同 Lyric.java —— 接收器字段化，才能在 onCatalystInstanceDestroy 里反注册。
  private BroadcastReceiver screenOnOffReceiver = null;

  private void registerScreenBroadcastReceiver() {
    if (screenOnOffReceiver != null) return;
    final IntentFilter theFilter = new IntentFilter();
    /** System Defined Broadcast */
    theFilter.addAction(Intent.ACTION_SCREEN_ON);
    theFilter.addAction(Intent.ACTION_SCREEN_OFF);

    screenOnOffReceiver = new BroadcastReceiver() {
      @Override
      public void onReceive(Context context, Intent intent) {
        String strAction = intent.getAction();

        WritableMap params = Arguments.createMap();

        switch (Objects.requireNonNull(strAction)) {
          case Intent.ACTION_SCREEN_OFF:

            params.putString("state", "OFF");
            utilsEvent.sendEvent(utilsEvent.SCREEN_STATE, params);
            break;
          case Intent.ACTION_SCREEN_ON:
            params.putString("state", "ON");
            utilsEvent.sendEvent(utilsEvent.SCREEN_STATE, params);
            break;
        }
      }
    };

    reactContext.registerReceiver(screenOnOffReceiver, theFilter);
  }

  /** A11-008：ReactContext 销毁时兜底反注册。 */
  @Override
  public void onCatalystInstanceDestroy() {
    super.onCatalystInstanceDestroy();
    if (screenOnOffReceiver == null) return;
    try {
      reactContext.unregisterReceiver(screenOnOffReceiver);
    } catch (Throwable ignored) {
    }
    screenOnOffReceiver = null;
  }

  @ReactMethod
  public void exitApp() {
    // https://github.com/wumke/react-native-exit-app/blob/master/android/src/main/java/com/github/wumke/RNExitApp/RNExitAppModule.java
    // android.os.Process.killProcess(android.os.Process.myPid());

    // https://stackoverflow.com/questions/6330200/how-to-quit-android-application-programmatically
    Activity currentActivity = reactContext.getCurrentActivity();
    Log.d("Utils", "Exit app...");
    if (currentActivity == null) {
      Log.d("Utils", "killProcess");
      android.os.Process.killProcess(android.os.Process.myPid());
    } else {
      currentActivity.finishAndRemoveTask();
      System.exit(0);
    }
  }

  @ReactMethod
  public void getSupportedAbis(Promise promise) {
    // https://github.com/react-native-device-info/react-native-device-info/blob/ff8f672cb08fa39a887567d6e23e2f08778e8340/android/src/main/java/com/learnium/RNDeviceInfo/RNDeviceModule.java#L877
    WritableArray array = new WritableNativeArray();
    for (String abi : Build.SUPPORTED_ABIS) {
      array.pushString(abi);
    }
    promise.resolve(array);
  }

  @ReactMethod
  public void installApk(String filePath, String fileProviderAuthority, Promise promise) {
    // https://github.com/mikehardy/react-native-update-apk/blob/master/android/src/main/java/net/mikehardy/rnupdateapk/RNUpdateAPK.java
    File file = new File(filePath);
    if (!file.exists()) {
      Log.e("Utils", "installApk: file doe snot exist '" + filePath + "'");
      // FIXME this should take a promise and fail it
      promise.reject("Utils", "installApk: file doe snot exist '" + filePath + "'");
      return;
    }

    // 记录待清理的安装包路径：安装完成后由 ApkInstallReceiver 删除。
    // 升级安装时本应用进程会被系统终止，动态注册的接收器收不到广播，只能靠静态广播（PACKAGE_REPLACED/PACKAGE_ADDED）
    reactContext.getSharedPreferences("apk_install", Context.MODE_PRIVATE)
        .edit().putString("installApkPath", filePath).apply();

    if (Build.VERSION.SDK_INT >= 24) {
      // API24 and up has a package installer that can handle FileProvider content:// URIs
      Uri contentUri;
      try {
        contentUri = FileProvider.getUriForFile(getReactApplicationContext(), fileProviderAuthority, file);
      } catch (Exception e) {
        // FIXME should be a Promise.reject really
        Log.e("Utils", "installApk exception with authority name '" + fileProviderAuthority + "'", e);
        promise.reject("Utils", "installApk exception with authority name '" + fileProviderAuthority + "'");
        return;
        // throw e;
      }
      Intent installApp = new Intent(Intent.ACTION_INSTALL_PACKAGE);
      installApp.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
      installApp.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      installApp.setData(contentUri);
      installApp.putExtra(Intent.EXTRA_INSTALLER_PACKAGE_NAME, reactContext.getApplicationInfo().packageName);
      reactContext.startActivity(installApp);
      promise.resolve(null);
    } else {
      // Old APIs do not handle content:// URIs, so use an old file:// style
      String cmd = "chmod 777 " + file;
      try {
        Runtime.getRuntime().exec(cmd);
      } catch (Exception e) {
        // e.printStackTrace();
        Log.e("Utils", "installApk exception : " + e.getMessage(), e);
        promise.reject("Utils", e.getMessage());
      }
      Intent intent = new Intent(Intent.ACTION_VIEW);
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      intent.setDataAndType(Uri.parse("file://" + file), "application/vnd.android.package-archive");
      reactContext.startActivity(intent);
      promise.resolve(null);
    }
  }

  @ReactMethod
  public void screenkeepAwake() {
    // https://github.com/corbt/react-native-keep-awake/blob/master/android/src/main/java/com/corbt/keepawake/KCKeepAwake.java
    final Activity activity = getCurrentActivity();

    if (activity != null) {
      activity.runOnUiThread(() -> {
        activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
      });
    }
  }

  @ReactMethod
  public void screenUnkeepAwake() {
    // https://github.com/corbt/react-native-keep-awake/blob/master/android/src/main/java/com/corbt/keepawake/KCKeepAwake.java
    final Activity activity = getCurrentActivity();

    if (activity != null) {
      activity.runOnUiThread(() -> {
        activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
      });
    }
  }

  /**
   保存图片到系统相册（长按封面保存，借鉴 MusicFree）
   Android 10+ 通过 MediaStore 免存储权限；Android 9- 走外部存储共享目录
   */
  @ReactMethod
  public void saveImageToGallery(String filePath, final Promise promise) {
    try {
      final File file = new File(filePath);
      if (!file.exists() || !file.isFile()) {
        promise.reject("SAVE_IMAGE_FAILED", "file not found: " + filePath);
        return;
      }
      new Thread(() -> {
        try {
          final String mime = "image/jpeg";
          final String displayName = file.getName();
          final ContentValues values = new ContentValues();
          values.put(MediaStore.MediaColumns.DISPLAY_NAME, displayName);
          values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/LXMusic");
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
          }
          final Uri target = reactContext.getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
          if (target == null) {
            promise.reject("SAVE_IMAGE_FAILED", "create media entry failed");
            return;
          }
          try (OutputStream out = reactContext.getContentResolver().openOutputStream(target);
               FileInputStream in = new FileInputStream(file)) {
            if (out == null) {
              promise.reject("SAVE_IMAGE_FAILED", "open output stream failed");
              return;
            }
            byte[] buf = new byte[8192];
            int len;
            while ((len = in.read(buf)) != -1) out.write(buf, 0, len);
          }
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            values.clear();
            values.put(MediaStore.MediaColumns.IS_PENDING, 0);
            reactContext.getContentResolver().update(target, values, null, null);
          }
          promise.resolve(true);
        } catch (Exception e) {
          promise.reject("SAVE_IMAGE_FAILED", e.getMessage());
        }
      }).start();
    } catch (Exception e) {
      promise.reject("SAVE_IMAGE_FAILED", e.getMessage());
    }
  }

  /**
   Gets the device's WiFi interface IP address
   @return device's WiFi IP if connected to WiFi, else '0.0.0.0'
   */
  @ReactMethod
  public void getWIFIIPV4Address(final Promise promise) throws Exception {
    // https://github.com/pusherman/react-native-network-info/blob/master/android/src/main/java/com/pusherman/networkinfo/RNNetworkInfo.java
    WifiManager wifi = (WifiManager) reactContext.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
    new Thread(new Runnable() {
      public void run() {
        try {
          WifiInfo info = wifi.getConnectionInfo();
          int ipAddress = info.getIpAddress();
          @SuppressLint("DefaultLocale") String stringip = String.format("%d.%d.%d.%d", (ipAddress & 0xff), (ipAddress >> 8 & 0xff),
            (ipAddress >> 16 & 0xff), (ipAddress >> 24 & 0xff));
          promise.resolve(stringip);
        }catch (Exception e) {
          promise.resolve(null);
        }
      }
    }).start();
  }

  // https://stackoverflow.com/a/26117646
  @ReactMethod
  public void getDeviceName(final Promise promise) {
    String manufacturer = Build.MANUFACTURER;
    String model = Build.MODEL;
    if (model.startsWith(manufacturer)) {
      promise.resolve(capitalize(model));
    } else {
      promise.resolve(capitalize(manufacturer) + " " + model);
    }
  }
  private String capitalize(String s) {
    if (s == null || s.isEmpty()) {
      return "";
    }
    char first = s.charAt(0);
    if (Character.isUpperCase(first)) {
      return s;
    } else {
      return Character.toUpperCase(first) + s.substring(1);
    }
  }

  @ReactMethod
  public void isNotificationsEnabled(final Promise promise) {
    new Thread(() -> {
      boolean enabled = NotificationPermissionUtil.isNotificationsEnabled(
        reactContext.getApplicationContext());
      promise.resolve(enabled);
    }).start();
  }

  @ReactMethod
  public void openNotificationPermissionActivity(Promise promise) {
    new Thread(() -> {
      boolean result = NotificationPermissionUtil.openNotificationPermissionActivity(
        reactContext.getApplicationContext());
      promise.resolve(result);
    }).start();
  }

  @ReactMethod
  public void shareText(String shareTitle, String title, String text) {
    Activity activity = reactContext.getCurrentActivity();
    if (activity == null) {
      Log.e("Utils", "shareText: no current activity");
      return;
    }
    Intent shareIntent = new Intent(Intent.ACTION_SEND);
    shareIntent.setType("text/plain");
    shareIntent.putExtra(Intent.EXTRA_TEXT, text);
    shareIntent.putExtra(Intent.EXTRA_SUBJECT, title);
    try {
      activity.startActivity(Intent.createChooser(shareIntent, shareTitle));
    } catch (Exception e) {
      Log.e("Utils", "shareText exception", e);
    }
  }

  @ReactMethod
  public void shareFile(String filePath, String fileProviderAuthority, String shareTitle, String title, Promise promise) {
    File file = new File(filePath);
    if (!file.exists()) {
      Log.e("Utils", "shareFile: file does not exist '" + filePath + "'");
      promise.reject("Utils", "shareFile: file does not exist '" + filePath + "'");
      return;
    }
    Uri contentUri;
    try {
      contentUri = FileProvider.getUriForFile(getReactApplicationContext(), fileProviderAuthority, file);
    } catch (Exception e) {
      Log.e("Utils", "shareFile exception with authority name '" + fileProviderAuthority + "'", e);
      promise.reject("Utils", e.getMessage());
      return;
    }
    Activity activity = reactContext.getCurrentActivity();
    if (activity == null) {
      Log.e("Utils", "shareFile: no current activity");
      promise.reject("Utils", "shareFile: no current activity");
      return;
    }
    Intent shareIntent = new Intent(Intent.ACTION_SEND);
    shareIntent.setType("audio/*");
    shareIntent.putExtra(Intent.EXTRA_STREAM, contentUri);
    shareIntent.putExtra(Intent.EXTRA_SUBJECT, title);
    shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
    try {
      activity.startActivity(Intent.createChooser(shareIntent, shareTitle));
      promise.resolve(null);
    } catch (Exception e) {
      Log.e("Utils", "shareFile exception", e);
      promise.reject("Utils", e.getMessage());
    }
  }

  @ReactMethod
  public void openFileInFileManager(String filePath, String fileProviderAuthority, Promise promise) {
    File file = new File(filePath);
    if (!file.exists()) {
      Log.e("Utils", "openFileInFileManager: file does not exist '" + filePath + "'");
      promise.reject("Utils", "file does not exist");
      return;
    }
    try {
      Uri contentUri = FileProvider.getUriForFile(getReactApplicationContext(), fileProviderAuthority, file);
      Activity activity = reactContext.getCurrentActivity();
      if (activity == null) {
        promise.reject("Utils", "no current activity");
        return;
      }
      // 先按文件的具体 MIME 打开；没有应用能处理时降级为 */*，
      // 这样系统文件管理器（小米/华为/MT 等）通常能接管并在其界面中定位到该文件
      Intent intent = new Intent(Intent.ACTION_VIEW);
      intent.setDataAndType(contentUri, getMimeType(filePath));
      intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
      if (intent.resolveActivity(activity.getPackageManager()) == null) {
        intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(contentUri, "*/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
      }
      activity.startActivity(intent);
      promise.resolve(true);
    } catch (Exception e) {
      Log.e("Utils", "openFileInFileManager exception", e);
      promise.reject("Utils", e.getMessage());
    }
  }

  // 下载完成后写入音频标签（借鉴 Spotube 下载完成写元数据）
  // coverPath 为本地封面文件路径（可选，null/空则只写文本标签）
  @ReactMethod
  public void writeAudioTag(String filePath, String title, String artist, String album, String coverPath, Promise promise) {
    new Thread(() -> {
      try {
        File audioFile = new File(filePath);
        if (!audioFile.exists()) {
          promise.reject("Utils", "file does not exist");
          return;
        }
        AudioFile af = AudioFileIO.read(audioFile);
        Tag tag = af.getTag();
        if (tag == null) {
          tag = af.createDefaultTag();
          af.setTag(tag);
        }
        if (title != null && !title.isEmpty()) tag.setField(FieldKey.TITLE, title);
        if (artist != null && !artist.isEmpty()) tag.setField(FieldKey.ARTIST, artist);
        if (album != null && !album.isEmpty()) tag.setField(FieldKey.ALBUM, album);
        if (coverPath != null && !coverPath.isEmpty()) {
          File coverFile = new File(coverPath);
          if (coverFile.exists()) {
            byte[] artBytes = readFileBytes(coverFile);
            if (artBytes.length > 0) {
              Artwork artwork = ArtworkFactory.createArtworkFromFile(coverFile);
              tag.setField(artwork);
            }
          }
        }
        af.commit();
        promise.resolve(true);
      } catch (Exception e) {
        Log.e("Utils", "writeAudioTag exception", e);
        promise.reject("Utils", e.getMessage());
      }
    }).start();
  }

  private byte[] readFileBytes(File file) throws Exception {
    ByteArrayOutputStream bos = new ByteArrayOutputStream();
    byte[] buf = new byte[8192];
    try (InputStream fis = new FileInputStream(file)) {
      int n;
      while ((n = fis.read(buf)) != -1) bos.write(buf, 0, n);
    }
    return bos.toByteArray();
  }

  private String getMimeType(String filePath) {
    String name = filePath.toLowerCase();
    if (name.endsWith(".flac")) return "audio/flac";
    if (name.endsWith(".mp3")) return "audio/mpeg";
    if (name.endsWith(".m4a") || name.endsWith(".aac")) return "audio/mp4";
    if (name.endsWith(".wav")) return "audio/wav";
    if (name.endsWith(".ogg")) return "audio/ogg";
    if (name.endsWith(".ape")) return "audio/ape";
    return "*/*";
  }

  // https://stackoverflow.com/questions/73463341/in-per-app-language-how-to-get-app-locale-in-api-33-if-system-locale-is-diffe
  @ReactMethod
  public void getSystemLocales(Promise promise) {
    Locale locale = null;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      LocaleListCompat list = LocaleManagerCompat.getSystemLocales(reactContext);
      if (!list.isEmpty()) {
        locale = list.get(0);
      } else {
        promise.resolve(null);
        return;
      }
    } else {
      locale = Locale.getDefault();
    }
    if (locale == null) {
      promise.resolve("");
      return;
    }

    // 格式化成 zh_cn、en_us 等
    String language = locale.getLanguage(); // zh, en
    String country = locale.getCountry();   // CN, US
    String localeStr;

    if (!country.isEmpty()) {
      localeStr = language.toLowerCase() + "_" + country.toLowerCase();
    } else {
      localeStr = language.toLowerCase();
    }

    promise.resolve(localeStr);
  }

  // https://github.com/Anthonyzou/react-native-full-screen/blob/master/android/src/main/java/com/rn/full/screen/FullScreen.java
  //  @ReactMethod
  //  public void onFullScreen() {
  //    UiThreadUtil.runOnUiThread(() -> {
  //      Activity currentActivity = reactContext.getCurrentActivity();
  //      if (currentActivity == null) return;
  //      currentActivity.getWindow().getDecorView().setSystemUiVisibility(
  //        View.SYSTEM_UI_FLAG_LAYOUT_STABLE
  //          | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
  //          | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
  //          | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION // hide nav bar
  //          | View.SYSTEM_UI_FLAG_FULLSCREEN // hide status bar
  //          | View.SYSTEM_UI_FLAG_IMMERSIVE
  //      );
  //    });
  //  }
  //  @ReactMethod
  //  public void offFullScreen() {
  //    UiThreadUtil.runOnUiThread(() -> {
  //      Activity currentActivity = reactContext.getCurrentActivity();
  //      if (currentActivity == null) return;
  //      currentActivity.getWindow().getDecorView().setSystemUiVisibility(
  //        View.SYSTEM_UI_FLAG_LAYOUT_STABLE
  //          | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
  //          | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
  //      );
  //    });
  //  }

  @ReactMethod
  public void getWindowSize(Promise promise) {
    WritableMap params = Arguments.createMap();

    Activity currentActivity = reactContext.getCurrentActivity();
    if (currentActivity == null) {
      params.putInt("width", 0);
      params.putInt("height", 0);
      promise.resolve(params);
      return;
    }
    // 获取当前应用可用区域大小
    Window window = currentActivity.getWindow();
    Rect rect = new Rect();
    window.getDecorView().getWindowVisibleDisplayFrame(rect);
    // View decorView = window.getDecorView();
    // int width = decorView.getMeasuredWidth();
    // int height = decorView.getMeasuredHeight();
    params.putInt("width", rect.width());
    params.putInt("height", rect.height());
    promise.resolve(params);
  }

  @ReactMethod
  public void isIgnoringBatteryOptimization(Promise promise) {
    new Thread(() -> {
      boolean result = BatteryOptimizationUtil.isIgnoringBatteryOptimization(
        reactContext.getApplicationContext(),
        reactContext.getPackageName()
      );
      promise.resolve(result);
    }).start();
  }

  @ReactMethod
  public void requestIgnoreBatteryOptimization(Promise promise) {
    new Thread(() -> {
      try {
        boolean result = BatteryOptimizationUtil.requestIgnoreBatteryOptimization(
          reactContext.getApplicationContext(),
          reactContext.getPackageName()
        );
        promise.resolve(result);
      } catch (Exception e) {
        promise.reject("ERROR", e);
      }
    }).start();
  }

  @ReactMethod
  public void isExternalStorageManager(Promise promise) {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        // Android 11+：判断"所有文件访问"（MANAGE_EXTERNAL_STORAGE）是否已开启
        promise.resolve(Environment.isExternalStorageManager());
      } else {
        // Android 10 及以下：判断普通存储写权限
        Activity activity = getCurrentActivity();
        boolean granted = activity != null
          && activity.checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
        promise.resolve(granted);
      }
    } catch (Exception e) {
      promise.reject("ERROR", e);
    }
  }
}

