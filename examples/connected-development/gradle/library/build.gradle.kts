plugins {
    `java-library`
    `maven-publish`
}

group = "com.example"
version = "1.0.0"

tasks.withType<JavaCompile>().configureEach {
    options.release = 17
}

publishing {
    publications {
        create<MavenPublication>("library") {
            from(components["java"])
        }
    }
}
