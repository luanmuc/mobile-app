package cn.toside.music.mobile.crypto;

import android.util.Base64;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;

import java.security.Key;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.spec.InvalidKeySpecException;
import java.security.spec.KeySpec;
import java.security.spec.PKCS8EncodedKeySpec;

public class CryptoModule extends ReactContextBaseJavaModule {
  private final ReactApplicationContext reactContext;

  CryptoModule(ReactApplicationContext reactContext) {
    super(reactContext);
    this.reactContext = reactContext;
  }

  @Override
  public String getName() {
    return "CryptoModule";
  }

  @ReactMethod
  public void generateRsaKey(Promise promise) {
    KeyPair kp = RSA.getKeyPair();
    // A11-006：getKeyPair() 在算法不可用/生成失败时返回 null，原实现直接 kp.getPublic() 必 NPE。
    if (kp == null) {
      promise.reject("-1", "failed to generate RSA key pair");
      return;
    }
    String publicKeyBytesBase64 = new String(Base64.encode(kp.getPublic().getEncoded(), Base64.DEFAULT));

    KeyFactory keyFac;
    try {
      keyFac = KeyFactory.getInstance("RSA");
    } catch (NoSuchAlgorithmException e) {
      promise.reject("-1", e.toString());
      return;
    }
    KeySpec keySpec = new PKCS8EncodedKeySpec(kp.getPrivate().getEncoded());
    Key key;
    try {
      key = keyFac.generatePrivate(keySpec);
    } catch (InvalidKeySpecException e) {
      promise.reject("-1", e.toString());
      return;
    }
    String privateKeyBytesBase64 = new String(Base64.encode(key.getEncoded(), Base64.DEFAULT));
    WritableMap params = Arguments.createMap();
    params.putString("publicKey", publicKeyBytesBase64);
    params.putString("privateKey", privateKeyBytesBase64);
    promise.resolve(params);
  }

  @ReactMethod
  public void rsaEncrypt(String text, String key, String padding, Promise promise) {
    // A11-005：AES/RSA 内部 catch 只 printStackTrace 后 return ""，桥接层原来无条件 resolve ——
    // 密钥非法/密文损坏时 JS 拿到空串且状态是成功，无法区分「空结果」与「失败」。
    // 非空输入却得到空结果，按失败 reject。
    String result = RSA.encryptRSAToString(text, key, padding);
    if (result.isEmpty() && !text.isEmpty()) {
      promise.reject("-1", "RSA encrypt failed");
      return;
    }
    promise.resolve(result);
    //    TaskRunner taskRunner = new TaskRunner();
    //    try {
    //      taskRunner.executeAsync(new GzipModule.UnGzip(source, target, force), (String errMessage) -> {
    //        if ("".equals(errMessage)) {
    //          promise.resolve(null);
    //        } else promise.reject("-2", errMessage);
    //      });
    //    } catch (RuntimeException err) {
    //      promise.reject("-2", err.getMessage());
    //    }
  }

  @ReactMethod
  public void rsaDecrypt(String text, String key, String padding, Promise promise) {
    // A11-005：同上，解密失败不再伪装成成功返回空串。
    String result = RSA.decryptRSAToString(text, key, padding);
    if (result.isEmpty() && !text.isEmpty()) {
      promise.reject("-1", "RSA decrypt failed");
      return;
    }
    promise.resolve(result);
    //    TaskRunner taskRunner = new TaskRunner();
    //    try {
    //      taskRunner.executeAsync(new GzipModule.UnGzip(source, target, force), (String errMessage) -> {
    //        if ("".equals(errMessage)) {
    //          promise.resolve(null);
    //        } else promise.reject("-2", errMessage);
    //      });
    //    } catch (RuntimeException err) {
    //      promise.reject("-2", err.getMessage());
    //    }
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  public String rsaEncryptSync(String text, String key, String padding) {
    return RSA.encryptRSAToString(text, key, padding);
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  public String rsaDecryptSync(String text, String key, String padding) {
    return RSA.decryptRSAToString(text, key, padding);
  }

  @ReactMethod
  public void aesEncrypt(String text, String key, String iv, String mode, Promise promise) {
    // A11-005：同上。
    String result = AES.encrypt(text, key, iv, mode);
    if (result.isEmpty() && !text.isEmpty()) {
      promise.reject("-1", "AES encrypt failed");
      return;
    }
    promise.resolve(result);
    //    TaskRunner taskRunner = new TaskRunner();
    //    try {
    //      taskRunner.executeAsync(new GzipModule.UnGzip(source, target, force), (String errMessage) -> {
    //        if ("".equals(errMessage)) {
    //          promise.resolve(null);
    //        } else promise.reject("-2", errMessage);
    //      });
    //    } catch (RuntimeException err) {
    //      promise.reject("-2", err.getMessage());
    //    }
  }

  @ReactMethod
  public void aesDecrypt(String text, String key, String iv, String mode, Promise promise) {
    // A11-005：同上。
    String result = AES.decrypt(text, key, iv, mode);
    if (result.isEmpty() && !text.isEmpty()) {
      promise.reject("-1", "AES decrypt failed");
      return;
    }
    promise.resolve(result);
    //    TaskRunner taskRunner = new TaskRunner();
    //    try {
    //      taskRunner.executeAsync(new GzipModule.UnGzip(source, target, force), (String errMessage) -> {
    //        if ("".equals(errMessage)) {
    //          promise.resolve(null);
    //        } else promise.reject("-2", errMessage);
    //      });
    //    } catch (RuntimeException err) {
    //      promise.reject("-2", err.getMessage());
    //    }
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  public String aesEncryptSync(String text, String key, String iv, String mode) {
    return AES.encrypt(text, key, iv, mode);
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  public String aesDecryptSync(String text, String key, String iv, String mode) {
    return AES.decrypt(text, key, iv, mode);
  }

  @ReactMethod
  public void sha1(String input, Promise promise) {
    try {
      MessageDigest md = MessageDigest.getInstance("SHA-1");
      byte[] messageDigest = md.digest(input.getBytes("UTF-8"));

      StringBuilder hexString = new StringBuilder();
      for (byte b : messageDigest) {
        String hex = Integer.toHexString(0xFF & b);
        if (hex.length() == 1) {
          hexString.append('0');
        }
        hexString.append(hex);
      }

      promise.resolve(hexString.toString());
    } catch (Exception e) {
      promise.reject("SHA1_ERROR", "哈希计算失败", e);
    }
  }

}

