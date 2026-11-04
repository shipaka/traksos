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
        maven { url = uri("https://artifactory-external.vkpartner.ru/artifactory/maven") }
    }
}

rootProject.name = "TrakSOS"
include(":app")
