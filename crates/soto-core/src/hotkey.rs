use serde::{Deserialize, Serialize};
use std::str::FromStr;
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Modifier {
    LeftAlt,
    LeftCtrl,
    LeftMeta,
    LeftShift,
    RightAlt,
    RightCtrl,
    RightMeta,
    RightShift,
    Fn,
}

impl Modifier {
    pub fn as_str(self) -> &'static str {
        match self {
            Modifier::LeftAlt => "LeftAlt",
            Modifier::LeftCtrl => "LeftCtrl",
            Modifier::LeftMeta => "LeftMeta",
            Modifier::LeftShift => "LeftShift",
            Modifier::RightAlt => "RightAlt",
            Modifier::RightCtrl => "RightCtrl",
            Modifier::RightMeta => "RightMeta",
            Modifier::RightShift => "RightShift",
            Modifier::Fn => "Fn",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ChordError {
    #[error("chord component is unknown: {0}")]
    UnknownComponent(String),
    #[error("chord must be a single modifier")]
    NotSingleModifier,
}

// A bound shortcut is exactly one modifier key (Right Cmd, Right Shift, Fn, ...).
// Combinations and letter/digit triggers are intentionally unsupported.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Chord {
    modifier: Modifier,
}

impl Chord {
    pub fn new(modifier: Modifier) -> Self {
        Self { modifier }
    }

    pub fn modifier(&self) -> Modifier {
        self.modifier
    }

    pub fn canonical(&self) -> String {
        self.modifier.as_str().to_owned()
    }

    pub fn parse(input: &str) -> Result<Self, ChordError> {
        if input.contains('+') {
            return Err(ChordError::NotSingleModifier);
        }
        match parse_modifier(input) {
            Some(modifier) => Ok(Self { modifier }),
            None => Err(ChordError::UnknownComponent(input.to_string())),
        }
    }
}

impl FromStr for Chord {
    type Err = ChordError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::parse(s)
    }
}

impl Serialize for Chord {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.canonical())
    }
}

impl<'de> Deserialize<'de> for Chord {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        Chord::parse(&s).map_err(serde::de::Error::custom)
    }
}

fn parse_modifier(token: &str) -> Option<Modifier> {
    Some(match token {
        "LeftAlt" => Modifier::LeftAlt,
        "LeftCtrl" => Modifier::LeftCtrl,
        "LeftMeta" => Modifier::LeftMeta,
        "LeftShift" => Modifier::LeftShift,
        "RightAlt" => Modifier::RightAlt,
        "RightCtrl" => Modifier::RightCtrl,
        "RightMeta" => Modifier::RightMeta,
        "RightShift" => Modifier::RightShift,
        "Fn" => Modifier::Fn,
        _ => return None,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HookEvent {
    Pressed { chord_index: usize },
    Released { chord_index: usize },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SwallowDecision {
    PassThrough,
    Swallow,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatchOutcome {
    pub events: Vec<HookEvent>,
    pub swallow: SwallowDecision,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_single_modifier() {
        let chord = Chord::parse("RightMeta").unwrap();
        assert_eq!(chord.modifier(), Modifier::RightMeta);
        assert_eq!(chord.canonical(), "RightMeta");
    }

    #[test]
    fn rejects_combination() {
        assert_eq!(
            Chord::parse("LeftCtrl+RightAlt"),
            Err(ChordError::NotSingleModifier)
        );
    }

    #[test]
    fn rejects_letter() {
        assert_eq!(
            Chord::parse("KeyA"),
            Err(ChordError::UnknownComponent("KeyA".into()))
        );
    }

    #[test]
    fn rejects_unknown_component() {
        assert_eq!(
            Chord::parse("Bogus"),
            Err(ChordError::UnknownComponent("Bogus".into())),
        );
    }

    #[test]
    fn serde_roundtrip() {
        let chord = Chord::new(Modifier::Fn);
        let json = serde_json::to_string(&chord).unwrap();
        assert_eq!(json, "\"Fn\"");
        let back: Chord = serde_json::from_str(&json).unwrap();
        assert_eq!(back, chord);
    }
}
