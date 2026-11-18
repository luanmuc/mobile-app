package cn.toside.music.mobile.cache;

import android.os.AsyncTask;

import com.facebook.react.bridge.Promise;

// https://github.com/midas-gufei/react-native-clear-app-cache/tree/master/android/src/main/java/com/learnta/clear
public class CacheClearAsyncTask extends AsyncTask<Integer,Integer,String> {
  public CacheModule cacheModule = null;
  public Promise promise;
  public CacheClearAsyncTask(CacheModule clearCacheModule, Promise promise) {
    super();
    this.cacheModule = clearCacheModule;
    this.promise = promise;
  }

  @Override
  protected void onPreExecute() {
    super.onPreExecute();
  }

  @Override
  protected void onPostExecute(String s) {
    super.onPostExecute(s);
    // A11-023：doInBackground 抛异常时 onPostExecute 不会拿到错误，Promise 永远不 settle，
    // JS 侧 await clearAppCache() 会一直挂起。失败信息由 doInBackground 带回这里 reject。
    if (s == null) promise.resolve(null);
    else promise.reject("clear_cache_failed", s);
  }

  @Override
  protected String doInBackground(Integer... params) {
    // A11-023：把异常转成可回传的字符串，避免 Promise 悬挂。
    try {
      cacheModule.clearCache();
      return null;
    } catch (Exception e) {
      return e.getMessage() != null ? e.getMessage() : e.toString();
    }
  }
}
