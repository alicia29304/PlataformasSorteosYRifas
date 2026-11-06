//! App de administracion (Tauri v2). Toda la logica vive en la interfaz web y en las firmas
//! de la cartera; aqui solo se abre el navegador del sistema.

/// Solo https: este comando lanza un proceso del sistema y no puede ser un abridor de
/// URLs arbitrario (`file:`, `javascript:`...).
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("solo se permiten URLs https".into());
    }
    #[cfg(target_os = "windows")]
    let r = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", &url])
        .spawn();
    #[cfg(not(target_os = "windows"))]
    let r = std::process::Command::new("xdg-open").arg(&url).spawn();
    r.map(|_| ()).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![open_external])
        .run(tauri::generate_context!())
        .expect("error al iniciar la aplicacion");
}
