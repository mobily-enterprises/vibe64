cmake_minimum_required(VERSION 3.24)
project(ExampleLibrary VERSION 1.0.0 LANGUAGES CXX)

add_library(example_library src/library.cpp)
add_library(example::library ALIAS example_library)
target_include_directories(example_library PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>)
target_compile_features(example_library PUBLIC cxx_std_17)
