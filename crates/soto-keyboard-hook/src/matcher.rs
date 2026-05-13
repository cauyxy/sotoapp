use soto_core::hotkey::{Chord, Modifier};
use std::collections::{BTreeSet, HashMap};

pub use soto_core::hotkey::{HookEvent, MatchOutcome, SwallowDecision};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputEdge {
    Down,
    Up,
}

#[derive(Default, Debug)]
pub struct Matcher {
    chords: Vec<Chord>,
    held_modifiers: BTreeSet<Modifier>,
    active: HashMap<usize, ()>,
}

impl Matcher {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn replace_chords(&mut self, chords: Vec<Chord>) -> Vec<HookEvent> {
        let mut released = Vec::new();
        for index in self.active.keys().copied() {
            released.push(HookEvent::Released { chord_index: index });
        }
        self.active.clear();
        self.chords = chords;
        released
    }

    pub fn clear_held(&mut self) -> Vec<HookEvent> {
        self.held_modifiers.clear();
        let mut released = Vec::new();
        for index in self.active.keys().copied() {
            released.push(HookEvent::Released { chord_index: index });
        }
        self.active.clear();
        released
    }

    pub fn feed(&mut self, modifier: Modifier, edge: InputEdge) -> MatchOutcome {
        match edge {
            InputEdge::Down => {
                self.held_modifiers.insert(modifier);
            }
            InputEdge::Up => {
                self.held_modifiers.remove(&modifier);
            }
        }

        let mut events = Vec::new();
        for (index, chord) in self.chords.iter().enumerate() {
            let matched_now = self.held_modifiers.contains(&chord.modifier());
            let was_active = self.active.contains_key(&index);
            if matched_now && !was_active {
                self.active.insert(index, ());
                events.push(HookEvent::Pressed { chord_index: index });
            } else if !matched_now && was_active {
                self.active.remove(&index);
                events.push(HookEvent::Released { chord_index: index });
            }
        }

        MatchOutcome {
            events,
            swallow: SwallowDecision::PassThrough,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chord(modifier: Modifier) -> Chord {
        Chord::new(modifier)
    }

    #[test]
    fn modifier_press_emits_pressed_pass_through() {
        let mut m = Matcher::new();
        m.replace_chords(vec![chord(Modifier::RightAlt)]);
        let outcome = m.feed(Modifier::RightAlt, InputEdge::Down);
        assert_eq!(outcome.events, vec![HookEvent::Pressed { chord_index: 0 }]);
        assert_eq!(outcome.swallow, SwallowDecision::PassThrough);
    }

    #[test]
    fn modifier_release_emits_released_pass_through() {
        let mut m = Matcher::new();
        m.replace_chords(vec![chord(Modifier::RightAlt)]);
        m.feed(Modifier::RightAlt, InputEdge::Down);
        let outcome = m.feed(Modifier::RightAlt, InputEdge::Up);
        assert_eq!(outcome.events, vec![HookEvent::Released { chord_index: 0 }]);
        assert_eq!(outcome.swallow, SwallowDecision::PassThrough);
    }

    #[test]
    fn unrelated_modifier_keeps_chord_active() {
        let mut m = Matcher::new();
        m.replace_chords(vec![chord(Modifier::RightAlt)]);
        m.feed(Modifier::RightAlt, InputEdge::Down);
        let outcome = m.feed(Modifier::LeftShift, InputEdge::Down);
        assert!(
            outcome.events.is_empty(),
            "incidental modifier should not toggle the chord"
        );
    }

    #[test]
    fn replace_chords_releases_active_match() {
        let mut m = Matcher::new();
        m.replace_chords(vec![chord(Modifier::RightAlt)]);
        m.feed(Modifier::RightAlt, InputEdge::Down);
        let released = m.replace_chords(Vec::new());
        assert_eq!(released, vec![HookEvent::Released { chord_index: 0 }]);
    }

    #[test]
    fn clear_held_releases_active_match() {
        let mut m = Matcher::new();
        m.replace_chords(vec![chord(Modifier::RightAlt)]);
        m.feed(Modifier::RightAlt, InputEdge::Down);
        let released = m.clear_held();
        assert_eq!(released, vec![HookEvent::Released { chord_index: 0 }]);
    }

    #[test]
    fn two_chords_track_independently() {
        let mut m = Matcher::new();
        m.replace_chords(vec![
            chord(Modifier::RightMeta),
            chord(Modifier::RightShift),
        ]);
        let outcome = m.feed(Modifier::RightMeta, InputEdge::Down);
        assert_eq!(outcome.events, vec![HookEvent::Pressed { chord_index: 0 }]);
        let outcome = m.feed(Modifier::RightShift, InputEdge::Down);
        assert_eq!(outcome.events, vec![HookEvent::Pressed { chord_index: 1 }]);
        let outcome = m.feed(Modifier::RightShift, InputEdge::Up);
        assert_eq!(outcome.events, vec![HookEvent::Released { chord_index: 1 }]);
    }
}
