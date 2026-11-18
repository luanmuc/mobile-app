package cn.toside.music.mobile.userApi;

import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Message;
import android.util.Log;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.ReactApplicationContext;

public class JavaScriptThread extends HandlerThread {
  private Handler handler;
  private QuickJS javaScriptExecutor;
  private final ReactApplicationContext reactContext;
  private final Bundle scriptInfo;

  JavaScriptThread(ReactApplicationContext context, Bundle info) {
    super("JavaScriptThread");
    this.reactContext = context;
    this.scriptInfo = info;
  }

  public void prepareHandler(final Handler mainHandler) {
    start();
    Log.d("UserApi [thread]", "running 2");
    this.handler = new Handler(getLooper()) {
      @Override
      public void handleMessage(@NonNull Message message) {
        if (javaScriptExecutor == null) {
          javaScriptExecutor = new QuickJS(reactContext, mainHandler);
          Log.d("UserApi [thread]", "javaScript executor created");
          String result = javaScriptExecutor.loadScript(scriptInfo);
          if ("".equals(result)) {
            Log.d("UserApi [thread]", "script loaded");
            mainHandler.sendEmptyMessage(HandlerWhat.INIT_SUCCESS);
          } else {
            Log.w("UserApi [thread]", "script load failed: " + result);
            mainHandler.sendMessage(mainHandler.obtainMessage(HandlerWhat.INIT_FAILED, result));
          }
        }
        switch (message.what) {
          case HandlerWhat.INIT: break;
          case HandlerWhat.ACTION: {
            // A11-002：executor 为 null（脚本加载失败或尚未初始化）时直接 callJS 会 NPE。
            if (javaScriptExecutor == null) {
              Log.w("UserApi [handler]", "action ignored: executor is null");
              return;
            }
            Object[] data = (Object[]) message.obj;
            // Log.d("UserApi [handler]", "handler action: " + data[0]);
            javaScriptExecutor.callJS((String) data[0], data[1]);
            return;
          }
          case HandlerWhat.DESTROY:
            // A11-002：同上，destroy 前判空（未初始化就销毁的场景会走到这里）。
            if (javaScriptExecutor != null) {
              javaScriptExecutor.destroy();
              javaScriptExecutor = null;
            }
            break;
          default:
            Log.w("UserApi [handler]", "Unknown message what: " + message.what);
            break;
        }
      }
    };
  }

  public Handler getHandler() {
    return this.handler;
  }

  public void stopThread() {
    // A11-003：quit() 会立刻清空消息队列 —— 刚 sendEmptyMessage 投进来的 DESTROY 直接被丢掉，
    // QuickJSContext 永不释放（每次重启音源泄漏一份 native 上下文）。
    // quitSafely() 会先把队列里已投递的消息处理完再退出，DESTROY 能真正执行。
    quitSafely();
  }
}
