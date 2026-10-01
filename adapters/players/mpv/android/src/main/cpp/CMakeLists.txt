cmake_minimum_required(VERSION 3.22)
project(sc-mpv)

# libmpv and its FFmpeg, out of the engine's own package: LIBMPV_JNI_DIR is
# where build.gradle unpacks them, one folder per ABI.
add_library(mpv SHARED IMPORTED)
set_target_properties(mpv PROPERTIES IMPORTED_LOCATION ${LIBMPV_JNI_DIR}/${ANDROID_ABI}/libmpv.so)

add_library(avcodec SHARED IMPORTED)
set_target_properties(avcodec PROPERTIES IMPORTED_LOCATION ${LIBMPV_JNI_DIR}/${ANDROID_ABI}/libavcodec.so)

add_library(sc-mpv SHARED sc-mpv.cpp)
target_link_libraries(sc-mpv mpv avcodec)
