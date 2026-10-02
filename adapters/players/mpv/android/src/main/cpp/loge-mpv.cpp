// libmpv, reached straight from this package.
//
// The engine's own Android wrapper (dev.jdtech.mpv.MPVLib) asks mpv for every
// log message and prints each one to the device log — including the line that
// names the stream it is opening, with a Jellyfin api_key or a portal's
// session token in it. Nothing turns that off: `msg-level` sets the terminal's
// level, while the level a client asked for is what mpv keeps generating for.
// So this package talks to libmpv's own C API instead, and never asks for a
// log message at all.
//
// Only the calls below are made, so libmpv's header is not vendored: these
// declarations are the published client API, and the package links the
// engine's libmpv.so, which fails the build rather than the device if one ever
// goes.

#include <jni.h>
#include <pthread.h>

#include <atomic>
#include <clocale>
#include <cstdint>

extern "C" {

typedef struct mpv_handle mpv_handle;

// mpv_format, as `client.h` numbers them.
enum {
  LOGE_MPV_FORMAT_NONE = 0,
  LOGE_MPV_FORMAT_STRING = 1,
  LOGE_MPV_FORMAT_FLAG = 3,
  LOGE_MPV_FORMAT_INT64 = 4,
  LOGE_MPV_FORMAT_DOUBLE = 5,
};

// mpv_event_id, of which this file acts on two.
enum {
  LOGE_MPV_EVENT_NONE = 0,
  LOGE_MPV_EVENT_SHUTDOWN = 1,
  LOGE_MPV_EVENT_PROPERTY_CHANGE = 22,
};

struct mpv_event_property {
  const char *name;
  int format;
  void *data;
};

struct mpv_event {
  int event_id;
  int error;
  uint64_t reply_userdata;
  void *data;
};

mpv_handle *mpv_create(void);
int mpv_initialize(mpv_handle *ctx);
void mpv_terminate_destroy(mpv_handle *ctx);
int mpv_set_option(mpv_handle *ctx, const char *name, int format, void *data);
int mpv_set_option_string(mpv_handle *ctx, const char *name, const char *data);
int mpv_command(mpv_handle *ctx, const char **args);
int mpv_set_property(mpv_handle *ctx, const char *name, int format, void *data);
int mpv_get_property(mpv_handle *ctx, const char *name, int format, void *data);
int mpv_observe_property(mpv_handle *ctx, uint64_t reply_userdata, const char *name, int format);
struct mpv_event *mpv_wait_event(mpv_handle *ctx, double timeout);
void mpv_wakeup(mpv_handle *ctx);
void mpv_free(void *data);

// FFmpeg needs both to decode through MediaCodec. Weak: an engine built
// without them decodes in software instead of failing to load.
__attribute__((weak)) int av_jni_set_java_vm(void *vm, void *log_ctx);
__attribute__((weak)) int av_jni_set_android_app_ctx(void *app_ctx, void *log_ctx);
}

namespace {

struct Instance {
  mpv_handle *mpv = nullptr;
  JavaVM *vm = nullptr;
  pthread_t thread = 0;
  std::atomic<bool> exiting{false};
  jobject surface = nullptr;
  jobject appContext = nullptr;
};

jclass listener = nullptr;
jmethodID onEvent = nullptr;
jmethodID onFlag = nullptr;
jmethodID onNumber = nullptr;
jmethodID onChange = nullptr;

Instance *of(jlong handle) { return reinterpret_cast<Instance *>(handle); }

bool cacheListener(JNIEnv *env) {
  if (listener != nullptr) return true;
  jclass found = env->FindClass("expo/modules/logempv/LogeMpvNative");
  if (found == nullptr) return false;
  listener = static_cast<jclass>(env->NewGlobalRef(found));
  env->DeleteLocalRef(found);
  onEvent = env->GetStaticMethodID(listener, "onEvent", "(JI)V");
  onFlag = env->GetStaticMethodID(listener, "onFlag", "(JLjava/lang/String;Z)V");
  onNumber = env->GetStaticMethodID(listener, "onNumber", "(JLjava/lang/String;D)V");
  onChange = env->GetStaticMethodID(listener, "onChange", "(JLjava/lang/String;)V");
  return onEvent != nullptr && onFlag != nullptr && onNumber != nullptr && onChange != nullptr;
}

/** mpv answers on a thread of its own; every answer goes to Kotlin from here. */
void *eventThread(void *argument) {
  auto *self = static_cast<Instance *>(argument);
  JNIEnv *env = nullptr;
  if (self->vm->AttachCurrentThread(&env, nullptr) != JNI_OK) return nullptr;
  const auto id = static_cast<jlong>(reinterpret_cast<intptr_t>(self));
  while (!self->exiting.load()) {
    mpv_event *event = mpv_wait_event(self->mpv, -1.0);
    if (self->exiting.load()) break;
    if (event == nullptr || event->event_id == LOGE_MPV_EVENT_NONE) continue;
    if (event->event_id == LOGE_MPV_EVENT_SHUTDOWN) break;
    if (event->event_id == LOGE_MPV_EVENT_PROPERTY_CHANGE) {
      auto *property = static_cast<mpv_event_property *>(event->data);
      if (property == nullptr || property->name == nullptr) continue;
      jstring name = env->NewStringUTF(property->name);
      if (property->format == LOGE_MPV_FORMAT_DOUBLE && property->data != nullptr) {
        env->CallStaticVoidMethod(listener, onNumber, id, name, *static_cast<double *>(property->data));
      } else if (property->format == LOGE_MPV_FORMAT_FLAG && property->data != nullptr) {
        env->CallStaticVoidMethod(listener, onFlag, id, name, *static_cast<int *>(property->data) != 0);
      } else {
        env->CallStaticVoidMethod(listener, onChange, id, name);
      }
      env->DeleteLocalRef(name);
    } else {
      env->CallStaticVoidMethod(listener, onEvent, id, static_cast<jint>(event->event_id));
    }
    if (env->ExceptionCheck()) env->ExceptionClear();
  }
  self->vm->DetachCurrentThread();
  return nullptr;
}

}  // namespace

extern "C" {

JNIEXPORT jlong JNICALL Java_expo_modules_logempv_LogeMpvNative_create(JNIEnv *env, jobject, jobject appContext) {
  if (!cacheListener(env)) return 0;
  // mpv parses numbers itself, and a comma for a decimal point breaks it.
  setlocale(LC_NUMERIC, "C");
  auto *self = new Instance();
  if (env->GetJavaVM(&self->vm) != JNI_OK || self->vm == nullptr) {
    delete self;
    return 0;
  }
  self->appContext = env->NewGlobalRef(appContext);
  if (av_jni_set_java_vm != nullptr) av_jni_set_java_vm(self->vm, nullptr);
  if (av_jni_set_android_app_ctx != nullptr) av_jni_set_android_app_ctx(self->appContext, nullptr);
  self->mpv = mpv_create();
  if (self->mpv == nullptr) {
    env->DeleteGlobalRef(self->appContext);
    delete self;
    return 0;
  }
  return static_cast<jlong>(reinterpret_cast<intptr_t>(self));
}

JNIEXPORT jboolean JNICALL Java_expo_modules_logempv_LogeMpvNative_init(JNIEnv *, jobject, jlong handle) {
  Instance *self = of(handle);
  if (self == nullptr || self->mpv == nullptr) return JNI_FALSE;
  if (mpv_initialize(self->mpv) < 0) return JNI_FALSE;
  if (pthread_create(&self->thread, nullptr, eventThread, self) != 0) {
    self->thread = 0;
    return JNI_FALSE;
  }
  pthread_setname_np(self->thread, "loge-mpv-events");
  return JNI_TRUE;
}

JNIEXPORT void JNICALL Java_expo_modules_logempv_LogeMpvNative_destroy(JNIEnv *env, jobject, jlong handle) {
  Instance *self = of(handle);
  if (self == nullptr) return;
  self->exiting.store(true);
  if (self->mpv != nullptr) mpv_wakeup(self->mpv);
  if (self->thread != 0) {
    pthread_join(self->thread, nullptr);
    self->thread = 0;
  }
  if (self->mpv != nullptr) {
    mpv_terminate_destroy(self->mpv);
    self->mpv = nullptr;
  }
  if (self->surface != nullptr) {
    env->DeleteGlobalRef(self->surface);
    self->surface = nullptr;
  }
  if (self->appContext != nullptr) {
    env->DeleteGlobalRef(self->appContext);
    self->appContext = nullptr;
  }
  delete self;
}

JNIEXPORT void JNICALL Java_expo_modules_logempv_LogeMpvNative_command(JNIEnv *env, jobject, jlong handle, jobjectArray parts) {
  Instance *self = of(handle);
  if (self == nullptr || self->mpv == nullptr) return;
  const jsize count = env->GetArrayLength(parts);
  if (count <= 0 || count > 16) return;
  const char *arguments[17] = {nullptr};
  jstring held[17] = {nullptr};
  for (jsize index = 0; index < count; index += 1) {
    held[index] = static_cast<jstring>(env->GetObjectArrayElement(parts, index));
    arguments[index] = env->GetStringUTFChars(held[index], nullptr);
  }
  mpv_command(self->mpv, arguments);
  for (jsize index = 0; index < count; index += 1) {
    if (held[index] == nullptr) continue;
    env->ReleaseStringUTFChars(held[index], arguments[index]);
    env->DeleteLocalRef(held[index]);
  }
}

JNIEXPORT void JNICALL Java_expo_modules_logempv_LogeMpvNative_setOptionString(JNIEnv *env, jobject, jlong handle, jstring name, jstring value) {
  Instance *self = of(handle);
  if (self == nullptr || self->mpv == nullptr) return;
  const char *cname = env->GetStringUTFChars(name, nullptr);
  const char *cvalue = env->GetStringUTFChars(value, nullptr);
  mpv_set_option_string(self->mpv, cname, cvalue);
  env->ReleaseStringUTFChars(name, cname);
  env->ReleaseStringUTFChars(value, cvalue);
}

JNIEXPORT void JNICALL Java_expo_modules_logempv_LogeMpvNative_setPropertyString(JNIEnv *env, jobject, jlong handle, jstring name, jstring value) {
  Instance *self = of(handle);
  if (self == nullptr || self->mpv == nullptr) return;
  const char *cname = env->GetStringUTFChars(name, nullptr);
  const char *cvalue = env->GetStringUTFChars(value, nullptr);
  mpv_set_property(self->mpv, cname, LOGE_MPV_FORMAT_STRING, &cvalue);
  env->ReleaseStringUTFChars(name, cname);
  env->ReleaseStringUTFChars(value, cvalue);
}

JNIEXPORT void JNICALL Java_expo_modules_logempv_LogeMpvNative_setPropertyInt(JNIEnv *env, jobject, jlong handle, jstring name, jint value) {
  Instance *self = of(handle);
  if (self == nullptr || self->mpv == nullptr) return;
  const char *cname = env->GetStringUTFChars(name, nullptr);
  int64_t wide = value;
  mpv_set_property(self->mpv, cname, LOGE_MPV_FORMAT_INT64, &wide);
  env->ReleaseStringUTFChars(name, cname);
}

JNIEXPORT void JNICALL Java_expo_modules_logempv_LogeMpvNative_setPropertyDouble(JNIEnv *env, jobject, jlong handle, jstring name, jdouble value) {
  Instance *self = of(handle);
  if (self == nullptr || self->mpv == nullptr) return;
  const char *cname = env->GetStringUTFChars(name, nullptr);
  double number = value;
  mpv_set_property(self->mpv, cname, LOGE_MPV_FORMAT_DOUBLE, &number);
  env->ReleaseStringUTFChars(name, cname);
}

JNIEXPORT void JNICALL Java_expo_modules_logempv_LogeMpvNative_setPropertyBoolean(JNIEnv *env, jobject, jlong handle, jstring name, jboolean value) {
  Instance *self = of(handle);
  if (self == nullptr || self->mpv == nullptr) return;
  const char *cname = env->GetStringUTFChars(name, nullptr);
  int flag = value == JNI_TRUE ? 1 : 0;
  mpv_set_property(self->mpv, cname, LOGE_MPV_FORMAT_FLAG, &flag);
  env->ReleaseStringUTFChars(name, cname);
}

JNIEXPORT jstring JNICALL Java_expo_modules_logempv_LogeMpvNative_getPropertyString(JNIEnv *env, jobject, jlong handle, jstring name) {
  Instance *self = of(handle);
  if (self == nullptr || self->mpv == nullptr) return nullptr;
  const char *cname = env->GetStringUTFChars(name, nullptr);
  char *value = nullptr;
  const int result = mpv_get_property(self->mpv, cname, LOGE_MPV_FORMAT_STRING, &value);
  env->ReleaseStringUTFChars(name, cname);
  if (result < 0 || value == nullptr) return nullptr;
  jstring answer = env->NewStringUTF(value);
  mpv_free(value);
  return answer;
}

JNIEXPORT jint JNICALL Java_expo_modules_logempv_LogeMpvNative_getPropertyInt(JNIEnv *env, jobject, jlong handle, jstring name, jint fallback) {
  Instance *self = of(handle);
  if (self == nullptr || self->mpv == nullptr) return fallback;
  const char *cname = env->GetStringUTFChars(name, nullptr);
  int64_t value = 0;
  const int result = mpv_get_property(self->mpv, cname, LOGE_MPV_FORMAT_INT64, &value);
  env->ReleaseStringUTFChars(name, cname);
  return result < 0 ? fallback : static_cast<jint>(value);
}

JNIEXPORT jdouble JNICALL Java_expo_modules_logempv_LogeMpvNative_getPropertyDouble(JNIEnv *env, jobject, jlong handle, jstring name, jdouble fallback) {
  Instance *self = of(handle);
  if (self == nullptr || self->mpv == nullptr) return fallback;
  const char *cname = env->GetStringUTFChars(name, nullptr);
  double value = 0;
  const int result = mpv_get_property(self->mpv, cname, LOGE_MPV_FORMAT_DOUBLE, &value);
  env->ReleaseStringUTFChars(name, cname);
  return result < 0 ? fallback : value;
}

JNIEXPORT jboolean JNICALL Java_expo_modules_logempv_LogeMpvNative_getPropertyBoolean(JNIEnv *env, jobject, jlong handle, jstring name, jboolean fallback) {
  Instance *self = of(handle);
  if (self == nullptr || self->mpv == nullptr) return fallback;
  const char *cname = env->GetStringUTFChars(name, nullptr);
  int value = 0;
  const int result = mpv_get_property(self->mpv, cname, LOGE_MPV_FORMAT_FLAG, &value);
  env->ReleaseStringUTFChars(name, cname);
  if (result < 0) return fallback;
  return value != 0 ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT void JNICALL Java_expo_modules_logempv_LogeMpvNative_observeProperty(JNIEnv *env, jobject, jlong handle, jstring name, jint format) {
  Instance *self = of(handle);
  if (self == nullptr || self->mpv == nullptr) return;
  const char *cname = env->GetStringUTFChars(name, nullptr);
  mpv_observe_property(self->mpv, 0, cname, format);
  env->ReleaseStringUTFChars(name, cname);
}

/** mpv's Android video output draws into the Surface it is handed as its window. */
JNIEXPORT void JNICALL Java_expo_modules_logempv_LogeMpvNative_attachSurface(JNIEnv *env, jobject, jlong handle, jobject surface) {
  Instance *self = of(handle);
  if (self == nullptr || self->mpv == nullptr) return;
  if (self->surface != nullptr) env->DeleteGlobalRef(self->surface);
  self->surface = env->NewGlobalRef(surface);
  int64_t window = reinterpret_cast<intptr_t>(self->surface);
  mpv_set_option(self->mpv, "wid", LOGE_MPV_FORMAT_INT64, &window);
}

JNIEXPORT void JNICALL Java_expo_modules_logempv_LogeMpvNative_detachSurface(JNIEnv *env, jobject, jlong handle) {
  Instance *self = of(handle);
  if (self == nullptr || self->mpv == nullptr) return;
  // The window is not taken back: with the video output gone, mpv holds
  // nothing, and a set of an option after initialisation waits for the core,
  // which at this moment never answers.
  if (self->surface != nullptr) {
    env->DeleteGlobalRef(self->surface);
    self->surface = nullptr;
  }
}
}
