plugins {
    application
}

repositories {
    // Where the published com.example:library:1.0.0 normally comes from in this fixture.
    mavenLocal()
}

dependencies {
    implementation("com.example:library:1.0.0")
}

tasks.withType<JavaCompile>().configureEach {
    options.release = 17
}

application {
    mainClass = "com.example.app.App"
}
