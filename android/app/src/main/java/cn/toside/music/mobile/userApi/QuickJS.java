package cn.toside.music.mobile.userApi;

import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Message;
import android.util.Base64;
import android.util.Log;
import cn.toside.music.mobile.crypto.AES;
import cn.toside.music.mobile.crypto.RSA;
import com.facebook.react.bridge.ReactApplicationContext;

import com.whl.quickjs.android.QuickJSLoader;
import com.whl.quickjs.wrapper.QuickJSContext;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;

public class QuickJS {
  private final Handler eventHandler;
  private String key;
  private final ReactApplicationContext reactContext;
  private boolean isInited = false;
  private QuickJSContext jsContext = null;
  final Handler timeoutHandler = new Handler();
  private boolean inited = false;

  public QuickJS(ReactApplicationContext context, Handler eventHandler) {
    this.reactContext = context;
    this.eventHandler = eventHandler;
  }

  private void init() {
    if (this.isInited) return;
    QuickJSLoader.init();
    this.key = UUID.randomUUID().toString();
    this.isInited = true;
  }

  private String getPreloadScript() {
    try {
      InputStream inputStream = this.reactContext.getAssets().open("script/user-api-preload.js");
      // A11-025：available() 不保证等于真实长度，read(buffer) 也不保证一次读完 ——
      // 脚本被截断会导致 preload 语法错误、音源整体不可用。改成循环读。
      ByteArrayOutputStream buffer = new ByteArrayOutputStream();
      byte[] chunk = new byte[4096];
      int read;
      while ((read = inputStream.read(chunk)) != -1) buffer.write(chunk, 0, read);
      inputStream.close();
      return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
    } catch (Exception e) {
      return null;
    }
  }

  private void createEnvObj(QuickJSContext jsContext) {
    jsContext.getGlobalObject().setProperty("__lx_native_call__", args -> {
      if (this.key.equals(args[0])) {
        callNative((String) args[1], (String) args[2]);
        return null;
      }
      return null;
    });
    jsContext.getGlobalObject().setProperty("__lx_native_call__utils_str2b64", args -> {
      try {
        return new String(Base64.encode(((String) args[0]).getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP));
      } catch (Exception e) {
        Log.e("UserApi [utils]", "utils_str2b64 error: " + e.getMessage());
        return "";
      }
    });
    jsContext.getGlobalObject().setProperty("__lx_native_call__utils_b642buf", args -> {
      try {
        byte[] byteArray = Base64.decode(((String) args[0]).getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
        StringBuilder jsonArrayString = new StringBuilder("[");
        for (int i = 0; i < byteArray.length; i++) {
          jsonArrayString.append((int) byteArray[i]);
          if (i < byteArray.length - 1) {
            jsonArrayString.append(",");
          }
        }
        jsonArrayString.append("]");
        return jsonArrayString.toString();
      } catch (Exception e) {
        Log.e("UserApi [utils]", "utils_b642buf error: " + e.getMessage());
        return "";
      }
    });
    jsContext.getGlobalObject().setProperty("__lx_native_call__utils_str2md5", args -> {
      try {
        // Log.d("UserApi [script call]", "utils_str2md5: " + args[0]);
        String str;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          str = URLDecoder.decode((String) args[0], StandardCharsets.UTF_8);
        } else {
          str = URLDecoder.decode((String) args[0], "UTF-8");
        }
        // Log.d("UserApi [script call]", "utils_str2md5: " + str);
        MessageDigest md = MessageDigest.getInstance("MD5");
        byte[] md5Bytes = md.digest(str.getBytes(StandardCharsets.UTF_8));
        StringBuilder md5String = new StringBuilder();
        for (byte b : md5Bytes) {
          // A11-001：显式做无符号化。Java 的 byte 是有符号的，负字节走 %02x 时行为依赖
          // Formatter 对 byte 重载的处理（不同实现/工具链可能给出 8 位 hex），MD5 串一旦变长
          // 签名参数就整体错位。`b & 0xFF` 保证恒为两位小写 hex。
          md5String.append(String.format("%02x", b & 0xFF));
        }
        return md5String.toString();
      } catch (Exception e) {
        Log.e("UserApi [utils]", "utils_str2md5 error: " + e.getMessage());
        return "";
      }
    });
    jsContext.getGlobalObject().setProperty("__lx_native_call__utils_aes_encrypt", args -> {
      try {
        return AES.encrypt((String) args[0], (String) args[1], (String) args[2], (String) args[3]);
      } catch (Exception e) {
        Log.e("UserApi [utils]", "utils_aes_encrypt error: " + e.getMessage());
        return "";
      }
    });
    jsContext.getGlobalObject().setProperty("__lx_native_call__utils_rsa_encrypt", args -> {
      try {
        return RSA.encryptRSAToString((String) args[0], (String) args[1], (String) args[2]);
      } catch (Exception e) {
        Log.e("UserApi [utils]", "utils_rsa_encrypt error: " + e.getMessage());
        return "";
      }
    });
    jsContext.getGlobalObject().setProperty("__lx_native_call__set_timeout", args -> {
      this.timeoutHandler.postDelayed(() -> {
        callJS("__set_timeout__", args[0]);
      }, (int) args[1]);
      return null;
    });
  }

  private boolean createJSEnv(String id, String name, String desc, String version, String author, String homepage, String rawScript) {
    init();
    QuickJSContext quickJSContext = this.jsContext;
    if (quickJSContext != null) quickJSContext.destroy();
    this.jsContext = QuickJSContext.create();
    this.jsContext.setConsole(new Console(this.eventHandler));
    String preloadScript = getPreloadScript();
    if (preloadScript == null) return false;
    createEnvObj(this.jsContext);
    this.jsContext.evaluate(preloadScript);
    this.jsContext.getGlobalObject().getJSFunction("lx_setup").call(this.key, id, name, desc, version, author, homepage, rawScript);
    return true;
  }

  private void callNative(String action, String data) {
    Message message = this.eventHandler.obtainMessage();
    message.what = HandlerWhat.ACTION;
    if ("init".equals(action)) {
      if (inited) return;
      inited = true;
    }
    message.obj = new Object[]{action, data};
    Log.d("UserApi [script call]", "script call action: " + action + " data: " + data);
    this.eventHandler.sendMessage(message);
  }

  public String loadScript(Bundle scriptInfo) {
    Log.d("UserApi", "UserApi Thread id: " + Thread.currentThread().getId());
    String script = scriptInfo.getString("script", "");
    if (createJSEnv(scriptInfo.getString("id", ""),
      scriptInfo.getString("name", "Unknown"),
      scriptInfo.getString("description", ""),
      scriptInfo.getString("version", ""),
      scriptInfo.getString("author", ""),
      scriptInfo.getString("homepage", ""),
      script)) {
      try {
        this.jsContext.evaluate(script);
        return "";
      } catch (Exception e) {
        Log.e("UserApi", "load script error: " + e.getMessage());
        try {
          callJS("__run_error__");
        } catch (Exception ignored) {}
        if (inited) return "";
        inited = true;
        return e.getMessage();
      }
    }
    return "create JavaScript Env failed";
  }

  public Object callJS(String action) {
    Object[] params = new Object[]{this.key, action};
    return callJS(params);
  }
  public Object callJS(String action, Object... args) {
    Object[] params = new Object[args.length + 2];
    params[0] = this.key;
    params[1] = action;
    System.arraycopy(args, 0, params, 2, args.length);
    return callJS(params);
  }
  public Object callJS(Object[] params) {
    try {
      return this.jsContext.getGlobalObject().getJSFunction("__lx_native__").call(params);
    } catch (Exception e) {
      Message message = eventHandler.obtainMessage();
      message.what = HandlerWhat.LOG;
      String msg = e.getMessage();
      if (msg == null) return null;
      if (msg.length() > 1024) msg = msg.substring(0, 1024) + "...";
      message.obj = new Object[]{"error", "Call script error: " + msg};
      eventHandler.sendMessage(message);
      Log.e("UserApi", "Call script error: " + e.getMessage());
      if (!this.inited) {
        eventHandler.sendMessage(eventHandler.obtainMessage(HandlerWhat.INIT_FAILED, msg));
        this.inited = true;
      }
      return null;
    }
  }

  public void destroy () {
    // A11-002：jsContext 可能为 null（loadScript 失败/重复 destroy）——直接 .destroy() 必 NPE。
    // 注意 callJS 有 try/catch 兜底，destroy 过去没有，这里是真正的崩溃点。
    if (this.jsContext == null) return;
    try {
      this.jsContext.destroy();
    } catch (Exception e) {
      Log.w("UserApi [quickjs]", "destroy failed: " + e.getMessage());
    }
    this.jsContext = null;
  }
}
