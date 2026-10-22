cmake_minimum_required(VERSION 3.24)
project(ExampleApp LANGUAGES CXX)

include(FetchContent)

# The normal, pinned dependency. Connected development never edits this file:
# it sets FETCHCONTENT_SOURCE_DIR_EXAMPLE_LIBRARY in an untracked build tree.
set(EXAMPLE_LIBRARY_GIT_REPOSITORY "https://github.com/acme/example-library.git"
  CACHE STRING "Git repository of Example Library")
FetchContent_Declare(example_library
  GIT_REPOSITORY "${EXAMPLE_LIBRARY_GIT_REPOSITORY}"
  GIT_TAG v1.0.0
  GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(example_library)

add_executable(app src/main.cpp)
target_link_libraries(app PRIVATE example::library)
