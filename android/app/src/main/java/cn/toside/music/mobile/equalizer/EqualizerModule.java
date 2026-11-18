package cn.toside.music.mobile.equalizer;

import android.media.audiofx.Equalizer;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;

/**
 * 均衡器（系统 Equalizer）封装。
 *
 * 为什么用 android.media.audiofx.Equalizer 而不是自建 DSP：
 * - 它是系统 Effect，工作在 AudioFlinger 的音频会话上，零额外依赖、零延迟；
 * - 只要拿到播放器的 audioSessionId 就能挂上去，不需要在音频管线里插处理器。
 *
 * 生命周期约法：
 * - bind(sessionId) 建立实例（sessionId 必须有效，ExoPlayer 未起播时是 0，必须拒绝）；
 * - sessionId 变了（换输出设备/重建播放器）必须 release 后重新 bind，否则效果挂在旧会话上不生效；
 * - 所有方法都 try/catch：部分设备/ROM 会直接抛 UnsupportedOperationException，
 *   此时 resolve(false) 让 JS 侧把面板置为不可用，而不是崩溃。
 */
public class EqualizerModule extends ReactContextBaseJavaModule {
  private Equalizer equalizer = null;
  private int boundSessionId = 0;

  EqualizerModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @Override
  public String getName() {
    return "EqualizerModule";
  }

  private synchronized void releaseInternal() {
    if (equalizer != null) {
      try {
        equalizer.setEnabled(false);
      } catch (Throwable ignored) {
      }
      try {
        equalizer.release();
      } catch (Throwable ignored) {
      }
      equalizer = null;
    }
    boundSessionId = 0;
  }

  /** 绑定到某个音频会话；已绑定到同一会话时直接复用。返回是否可用。 */
  @ReactMethod
  public synchronized void bind(final int sessionId, final Promise promise) {
    if (sessionId == 0) {
      promise.resolve(false);
      return;
    }
    if (equalizer != null && boundSessionId == sessionId) {
      promise.resolve(true);
      return;
    }
    releaseInternal();
    try {
      equalizer = new Equalizer(0, sessionId);
      boundSessionId = sessionId;
      promise.resolve(true);
    } catch (Throwable e) {
      releaseInternal();
      promise.resolve(false);
    }
  }

  /** 一次性取回档位信息：band 数、电平范围（毫贝）、各 band 中心频率（Hz）。 */
  @ReactMethod
  public synchronized void getInfo(final Promise promise) {
    if (equalizer == null) {
      promise.resolve(null);
      return;
    }
    try {
      short bands = equalizer.getNumberOfBands();
      short[] range = equalizer.getBandLevelRange();
      WritableMap res = Arguments.createMap();
      res.putInt("bands", bands);
      res.putInt("levelMin", range[0]);
      res.putInt("levelMax", range[1]);
      com.facebook.react.bridge.WritableArray centers = Arguments.createArray();
      for (short i = 0; i < bands; i++) {
        centers.pushInt(equalizer.getCenterFreq(i) / 1000);
      }
      res.putArray("centers", centers);
      promise.resolve(res);
    } catch (Throwable e) {
      promise.resolve(null);
    }
  }

  /**
   * 应用整组电平。levelsCsv 形如 "-300,0,0,200,500"，单位毫贝，越界由系统自动夹取。
   * 传入空串表示全部归零。
   */
  @ReactMethod
  public synchronized void applyBands(final String levelsCsv, final Promise promise) {
    if (equalizer == null) {
      promise.resolve(false);
      return;
    }
    try {
      short bands = equalizer.getNumberOfBands();
      String[] parts = (levelsCsv == null ? "" : levelsCsv).split(",");
      for (short i = 0; i < bands; i++) {
        int level = 0;
        if (i < parts.length && !parts[i].trim().isEmpty()) {
          try {
            level = (int) Math.round(Double.parseDouble(parts[i].trim()));
          } catch (NumberFormatException ignored) {
            level = 0;
          }
        }
        equalizer.setBandLevel(i, (short) level);
      }
      promise.resolve(true);
    } catch (Throwable e) {
      promise.resolve(false);
    }
  }

  @ReactMethod
  public synchronized void setEnabled(final boolean enabled, final Promise promise) {
    if (equalizer == null) {
      promise.resolve(false);
      return;
    }
    try {
      equalizer.setEnabled(enabled);
      promise.resolve(true);
    } catch (Throwable e) {
      promise.resolve(false);
    }
  }

  @ReactMethod
  public synchronized void release(final Promise promise) {
    releaseInternal();
    promise.resolve(true);
  }
}
