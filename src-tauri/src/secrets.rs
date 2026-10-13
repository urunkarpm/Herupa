use std::fs;
use std::path::PathBuf;
use keyring::Entry;

const SERVICE_NAME: &str = "sleek_desktop_assistant";
const KEY_NAME: &str = "gemini_api_key";

pub struct SecretsManager {
    fallback_path: PathBuf,
}

impl SecretsManager {
    pub fn new(app_dir: PathBuf) -> Self {
        let fallback_path = app_dir.join(".gemini_key");
        Self { fallback_path }
    }

    pub fn get_api_key(&self) -> Result<Option<String>, String> {
        // First try OS keychain
        if let Ok(entry) = Entry::new(SERVICE_NAME, KEY_NAME) {
            if let Ok(password) = entry.get_password() {
                if !password.trim().is_empty() {
                    return Ok(Some(password));
                }
            }
        }

        // Fallback to local secure app store file if keychain fails/empty
        if self.fallback_path.exists() {
            if let Ok(content) = fs::read_to_string(&self.fallback_path) {
                let trimmed = content.trim().to_string();
                if !trimmed.is_empty() {
                    return Ok(Some(trimmed));
                }
            }
        }

        Ok(None)
    }

    pub fn store_api_key(&self, key: &str) -> Result<(), String> {
        let key = key.trim();
        let mut stored_in_keyring = false;

        if let Ok(entry) = Entry::new(SERVICE_NAME, KEY_NAME) {
            if entry.set_password(key).is_ok() {
                stored_in_keyring = true;
            }
        }

        if !stored_in_keyring {
            if let Some(parent) = self.fallback_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            fs::write(&self.fallback_path, key).map_err(|e| format!("Failed to save API key to fallback store: {}", e))?;
        } else {
            // Remove fallback file if successfully saved in keyring
            let _ = fs::remove_file(&self.fallback_path);
        }

        Ok(())
    }

    pub fn delete_api_key(&self) -> Result<(), String> {
        if let Ok(entry) = Entry::new(SERVICE_NAME, KEY_NAME) {
            let _ = entry.delete_password();
        }
        if self.fallback_path.exists() {
            let _ = fs::remove_file(&self.fallback_path);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_secrets_fallback_store() {
        let dir = tempdir().unwrap();
        let manager = SecretsManager::new(dir.path().to_path_buf());

        // Initially no key stored
        assert_eq!(manager.get_api_key().unwrap(), None);

        // Store a key
        manager.store_api_key("test_secret_key_12345").unwrap();
        assert_eq!(manager.get_api_key().unwrap(), Some("test_secret_key_12345".to_string()));

        // Delete key
        manager.delete_api_key().unwrap();
        assert_eq!(manager.get_api_key().unwrap(), None);
    }
}
