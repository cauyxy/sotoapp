use crate::{DictionaryEntry, DictionaryStatus};

pub trait DictionaryReader {
    fn read_dictionary(&self) -> Result<Vec<DictionaryEntry>, String>;
}

pub fn collect_hotwords(storage: &impl DictionaryReader) -> Result<Vec<String>, String> {
    Ok(storage
        .read_dictionary()?
        .into_iter()
        .filter(|entry| entry.enabled && entry.status == DictionaryStatus::Active)
        .map(|entry| entry.term)
        .collect())
}
