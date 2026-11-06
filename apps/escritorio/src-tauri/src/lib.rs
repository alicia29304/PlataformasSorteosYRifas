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

const SERVICIO: &str = "SorteosWeb3Admin";

/// Solo estos dos secretos: la interfaz no puede leer otras credenciales del usuario.
fn entrada(nombre: &str) -> Result<keyring::Entry, String> {
    if nombre != "sesion" && nombre != "claves" {
        return Err("secreto desconocido".into());
    }
    keyring::Entry::new(SERVICIO, nombre).map_err(|e| e.to_string())
}

/// Administrador de credenciales de Windows: protegido con la cuenta del usuario.
#[tauri::command]
fn guardar_secreto(nombre: String, valor: String) -> Result<(), String> {
    entrada(&nombre)?.set_password(&valor).map_err(|e| e.to_string())
}

#[tauri::command]
fn leer_secreto(nombre: String) -> Result<Option<String>, String> {
    match entrada(&nombre)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn borrar_secreto(nombre: String) -> Result<(), String> {
    match entrada(&nombre)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![open_external, guardar_secreto, leer_secreto, borrar_secreto])
        .run(tauri::generate_context!())
        .expect("error al iniciar la aplicacion");
}
