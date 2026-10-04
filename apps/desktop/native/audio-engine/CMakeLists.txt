cmake_minimum_required(VERSION 3.16)
project(audio-engine LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(audio-engine
    main.cpp
    pcm_ring_buffer.cpp
    pcm_ring_buffer.hpp
    fft.hpp
    json.hpp
    mpv_client.h
)

find_package(Threads REQUIRED)
target_link_libraries(audio-engine PRIVATE Threads::Threads)

if(UNIX AND NOT APPLE)
    target_link_libraries(audio-engine PRIVATE ${CMAKE_DL_LIBS})
    set_target_properties(audio-engine PROPERTIES
        BUILD_RPATH "\$ORIGIN"
        INSTALL_RPATH "\$ORIGIN"
    )
elseif(APPLE)
    target_link_libraries(audio-engine PRIVATE ${CMAKE_DL_LIBS})
    set_target_properties(audio-engine PROPERTIES
        BUILD_RPATH "@executable_path;@loader_path"
        INSTALL_RPATH "@executable_path;@loader_path"
    )
endif()
