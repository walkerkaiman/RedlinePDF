// RedlinePDF - Construction Markup Tool
// Tauri backend - minimal shell, all logic runs in the web frontend.

use std::env::consts::{OS, ARCH};
use std::fs;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![check_for_update, download_update])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[derive(serde::Deserialize, Debug)]
struct GitHubRelease {
    tag_name: String,
    assets: Vec<GitHubAsset>,
}

#[derive(serde::Deserialize, Debug)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
}

/// Returns the latest version and download URL for the current platform.
#[tauri::command]
async fn check_for_update() -> Result<UpdateInfo, String> {
    let client = reqwest::ClientBuilder::new()
        .user_agent("RedlinePDF-Updater")
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let response = client
        .get("https://api.github.com/repos/walkerkaiman/RedlinePDF/releases/latest")
        .send()
        .await
        .map_err(|e| format!("GitHub API request failed: {}", e))?;

    if !response.status().is_success() {
        // No releases yet or API error — treat as "no update available"
        return Ok(UpdateInfo {
            latest_version: String::new(),
            has_update: false,
            download_url: String::new(),
            asset_name: format!("API returned status {}", response.status()),
        });
    }

    let release: GitHubRelease = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse release JSON: {}", e))?;

    // Find the correct asset for this platform
    let (asset_name, download_url) = find_platform_asset(&release.assets);

    Ok(UpdateInfo {
        latest_version: release.tag_name.trim_start_matches('v').to_string(),
        has_update: true, // Frontend compares versions itself
        download_url,
        asset_name,
    })
}

/// Download the update file to a temp location and return its path.
#[tauri::command]
async fn download_update(download_url: String) -> Result<String, String> {
    let client = reqwest::ClientBuilder::new()
        .user_agent("RedlinePDF-Updater")
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    // Determine platform-specific temp filename
    let (_ext, tmp_file) = match OS {
        "linux" => ("deb", "/tmp/redlinepdf-update.deb".to_string()),
        "macos" => ("dmg", "/tmp/redlinepdf-update.dmg".to_string()),
        "windows" => ("exe", r"C:\Users\Public\Downloads\redlinepdf-setup.exe".to_string()),
        _ => return Err(format!("Unsupported platform: {}", OS)),
    };

    // Download the file
    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download returned status {}",
            response.status()
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read download bytes: {}", e))?;

    fs::write(&tmp_file, &bytes)
        .map_err(|e| format!("Failed to write update file: {}", e))?;

    Ok(tmp_file)
}

/// Find the correct asset for the current OS/arch combination.
fn find_platform_asset(assets: &[GitHubAsset]) -> (String, String) {
    let platform = format!("{}-{}", OS, ARCH);

    // Priority order: exact match > partial match > first available
    for asset in assets {
        if asset.name.to_lowercase().contains(&platform.to_lowercase()) {
            return (asset.name.clone(), asset.browser_download_url.clone());
        }
    }

    // Fallback to first asset if no platform-specific one found
    if let Some(first) = assets.first() {
        return (first.name.clone(), first.browser_download_url.clone());
    }

    ("No matching asset".to_string(), String::new())
}

#[derive(serde::Serialize)]
struct UpdateInfo {
    latest_version: String,
    has_update: bool,
    download_url: String,
    asset_name: String,
}
