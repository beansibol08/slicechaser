cmake_minimum_required(VERSION 3.20)

# Resolume on Apple Silicon runs natively, so Mac plugins must be universal (arm64 + x86_64).
if(APPLE)
    set(CMAKE_OSX_ARCHITECTURES "arm64;x86_64" CACHE STRING "Mac architectures")
    set(CMAKE_OSX_DEPLOYMENT_TARGET "10.15" CACHE STRING "Minimum macOS")
endif()

project(SliceChaser VERSION 1.0 LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Release)
endif()

# ---------------------------------------------------------------- FFGL SDK
# Point FFGL_SDK_DIR at a local checkout of github.com/resolume/ffgl, or leave it
# empty to download the pinned version automatically.
set(FFGL_SDK_DIR "" CACHE PATH "Path to a checkout of resolume/ffgl")
if(NOT FFGL_SDK_DIR)
    include(FetchContent)
    FetchContent_Declare(ffgl
        GIT_REPOSITORY https://github.com/resolume/ffgl.git
        GIT_TAG        5b6e07840277df9ec35a228b9eb067636316350f
        GIT_SHALLOW    FALSE
        SOURCE_SUBDIR  do-not-add-subdirectory)  # we compile its sources ourselves
    FetchContent_MakeAvailable(ffgl)
    set(FFGL_SDK_DIR "${ffgl_SOURCE_DIR}")
endif()
set(FFGL_LIB "${FFGL_SDK_DIR}/source/lib")
set(GLEW_DIR "${FFGL_SDK_DIR}/deps/glew-2.1.0")

# ---------------------------------------------------------------- shared code
# The chase-file logic has no OpenGL in it, so it is also used by the unit tests.
add_library(slicechaser_core STATIC src/ChaseData.cpp)
target_include_directories(slicechaser_core PUBLIC src)
set_target_properties(slicechaser_core PROPERTIES POSITION_INDEPENDENT_CODE ON)
if(WIN32)
    target_link_libraries(slicechaser_core PUBLIC shell32 ole32)
endif()

# FFGL + renderer compiled once, then linked whole into each plugin.
# (An OBJECT library guarantees plugMain is kept; a static library could drop it.)
add_library(slicechaser_ffgl OBJECT
    ${FFGL_LIB}/FFGLSDK.cpp
    src/SliceRenderer.cpp
    src/ChaseEffect.cpp)
target_include_directories(slicechaser_ffgl PUBLIC ${FFGL_LIB} src)
set_target_properties(slicechaser_ffgl PROPERTIES POSITION_INDEPENDENT_CODE ON)
if(NOT APPLE)
    target_include_directories(slicechaser_ffgl PUBLIC ${GLEW_DIR}/include)
    target_compile_definitions(slicechaser_ffgl PUBLIC GLEW_STATIC)
endif()
if(MSVC)
    target_compile_definitions(slicechaser_ffgl PUBLIC _CRT_SECURE_NO_WARNINGS NOMINMAX)
endif()
if(UNIX AND NOT APPLE)
    target_compile_definitions(slicechaser_ffgl PUBLIC GLEW_NO_GLU)
endif()

function(add_ffgl_plugin name source)
    add_library(${name} MODULE ${source} $<TARGET_OBJECTS:slicechaser_ffgl>)
    target_include_directories(${name} PRIVATE ${FFGL_LIB} src)
    target_link_libraries(${name} PRIVATE slicechaser_core)
    if(NOT APPLE)
        target_include_directories(${name} PRIVATE ${GLEW_DIR}/include)
        target_compile_definitions(${name} PRIVATE GLEW_STATIC)
    endif()
    if(MSVC)
        target_compile_definitions(${name} PRIVATE _CRT_SECURE_NO_WARNINGS NOMINMAX)
    endif()

    if(WIN32)
        target_link_libraries(${name} PRIVATE "${GLEW_DIR}/lib/Release/x64/glew32s.lib" opengl32)
        set_target_properties(${name} PROPERTIES PREFIX "" SUFFIX ".dll")
    elseif(APPLE)
        target_link_libraries(${name} PRIVATE "-framework OpenGL" "-framework Carbon" "-framework AppKit")
        set_target_properties(${name} PROPERTIES
            BUNDLE TRUE
            BUNDLE_EXTENSION bundle
            MACOSX_BUNDLE_GUI_IDENTIFIER "com.slicechaser.${name}"
            MACOSX_BUNDLE_BUNDLE_NAME "${name}")
    else()
        # Linux: FFGL hosts are rare here; this exists so the code can be compile-checked.
        target_compile_definitions(${name} PRIVATE GLEW_NO_GLU)
        set_target_properties(${name} PROPERTIES PREFIX "")
    endif()

    set_target_properties(${name} PROPERTIES
        LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/out"
        LIBRARY_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/out"
        LIBRARY_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/out")
endfunction()

add_ffgl_plugin(SliceChaser src/ChaserFX.cpp)
add_ffgl_plugin(SliceBumper src/BumperFX.cpp)

# ---------------------------------------------------------------- tests
option(SLICECHASER_TESTS "Build unit tests" ON)
if(SLICECHASER_TESTS)
    enable_testing()
    add_executable(slicechaser_tests tests/test_core.cpp)
    target_link_libraries(slicechaser_tests PRIVATE slicechaser_core)
    add_test(NAME core COMMAND slicechaser_tests)
endif()

# Headless end-to-end test: loads the built plugins like a host would and checks
# rendered pixels. Linux + Mesa only (needs libegl-dev); used in CI.
option(SLICECHASER_GL_TEST "Build the headless OpenGL test host" OFF)
if(SLICECHASER_GL_TEST AND UNIX AND NOT APPLE)
    find_package(Python3 REQUIRED COMPONENTS Interpreter)
    set(SHIM "${CMAKE_BINARY_DIR}/glew_shim.cpp")
    add_custom_command(OUTPUT ${SHIM}
        COMMAND Python3::Interpreter ${CMAKE_CURRENT_SOURCE_DIR}/tests/make_glew_shim.py
                $<TARGET_FILE:SliceChaser> $<TARGET_FILE:SliceBumper> ${SHIM}
        DEPENDS SliceChaser SliceBumper tests/make_glew_shim.py)
    add_executable(gl_host tests/gl_host.cpp ${SHIM})
    target_include_directories(gl_host PRIVATE ${GLEW_DIR}/include)
    target_link_libraries(gl_host PRIVATE EGL GL ${CMAKE_DL_LIBS})
    set_target_properties(gl_host PROPERTIES ENABLE_EXPORTS ON)
    add_test(NAME gl COMMAND gl_host $<TARGET_FILE:SliceChaser> $<TARGET_FILE:SliceBumper>)
    set_tests_properties(gl PROPERTIES ENVIRONMENT "LIBGL_ALWAYS_SOFTWARE=1;EGL_PLATFORM=surfaceless")
endif()
