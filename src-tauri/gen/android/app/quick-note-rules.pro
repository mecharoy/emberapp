# window.EmberAndroid: R8 would otherwise rename or drop the methods the
# webview calls by name.
-keepclassmembers class dev.abhij.ember.mobile.EmberBridge {
    @android.webkit.JavascriptInterface <methods>;
}
