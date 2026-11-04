pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // RuStore SDK (пуши)
        maven { url = uri("https://nexus-external.rustore.ru/repository/maven-rustore-exposed/") }
    }
}

rootProject.name = "TrakSOS"
include(":app")
