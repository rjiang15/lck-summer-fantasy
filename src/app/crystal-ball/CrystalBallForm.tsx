"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { ChampionIcon, ChampionLabel, TeamLabel, TeamLogo } from "@/components/GameIdentity";
import { DRAKE_ANSWERS, PENTAKILL_ANSWERS, YES_NO_ANSWERS } from "@/lib/crystal-ball-options";
import { saveAllCrystalBall, type CrystalBallSaveState } from "./actions";

type Question = {
  id: number;
  prompt: string;
  answerType: string;
  points: number;
  gradingMode: string;
  existing: string;
};

type PlayerOption = {
  value: string;
  label: string;
  team: string | null;
  role: string | null;
};

type Picker = {
  questionId: number;
  type: "champion" | "team" | "player";
};

const ROLE_GROUPS = [
  { key: "top", label: "Top" },
  { key: "jungle", label: "Jungle" },
  { key: "mid", label: "Mid" },
  { key: "bot", label: "Bot" },
  { key: "support", label: "Support" },
] as const;

function normalizeRole(role: string | null) {
  const value = role?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
  if (["jungle", "jungler", "jg"].includes(value)) return "jungle";
  if (["middle", "mid", "midlane"].includes(value)) return "mid";
  if (["bot", "bottom", "adc", "carry"].includes(value)) return "bot";
  if (["support", "supp", "sup"].includes(value)) return "support";
  if (["top", "toplane"].includes(value)) return "top";
  return "other";
}

export default function CrystalBallForm({
  leagueId,
  questions,
  teams,
  players,
  champions,
}: {
  leagueId: number;
  questions: Question[];
  teams: string[];
  players: PlayerOption[];
  champions: string[];
}) {
  const [result, formAction, pending] = useActionState<CrystalBallSaveState, FormData>(saveAllCrystalBall, null);
  const [answers, setAnswers] = useState<Record<number, string>>(() =>
    Object.fromEntries(questions.map((question) => [question.id, question.existing])),
  );
  const [picker, setPicker] = useState<Picker | null>(null);
  const playerNames = useMemo(() => new Map(players.map((player) => [player.value, player.label])), [players]);
  const selectedCount = questions.filter((question) => answers[question.id]).length;

  function setAnswer(questionId: number, answer: string) {
    setAnswers((current) => ({ ...current, [questionId]: answer }));
  }

  function chooseFromPicker(answer: string) {
    if (!picker) return;
    setAnswer(picker.questionId, answer);
    setPicker(null);
  }

  return <>
    <form action={formAction} className="crystal-form">
      <input type="hidden" name="leagueId" value={leagueId} />
      <div className="crystal-grid">
        {questions.map((question, index) => {
          const answer = answers[question.id] ?? "";
          return <section className={`card crystal-question${answer ? " answered" : ""}`} key={question.id}>
            <div className="crystal-question-title">
              <span>{index + 1}</span>
              <div>
                <h2>{question.prompt}</h2>
                <p>{questionScoreLabel(question)}</p>
              </div>
            </div>
            <input type="hidden" name={`answer_${question.id}`} value={answer} />
            <PredictionControl
              question={question}
              answer={answer}
              playerName={playerNames.get(answer)}
              onAnswer={(value) => setAnswer(question.id, value)}
              onOpenPicker={() => setPicker({ questionId: question.id, type: question.answerType as Picker["type"] })}
            />
          </section>;
        })}
      </div>
      <section className="card crystal-save-bar">
        <div>
          <b>{selectedCount} of {questions.length} predictions selected</b>
          <span className="muted small">Save partial progress now; all 20 must be filled before Crystal Ball locks.</span>
        </div>
        <button type="submit" disabled={pending || selectedCount === 0}>{pending ? "Saving…" : "Save all predictions"}</button>
      </section>
      {result && <p className={`${result.ok ? "notice" : "error"} card`} aria-live="polite">{result.message}</p>}
    </form>
    {picker && <PredictionPicker
      picker={picker}
      teams={teams}
      players={players}
      champions={champions}
      onChoose={chooseFromPicker}
      onClose={() => setPicker(null)}
    />}
  </>;
}

function questionScoreLabel(question: Pick<Question, "gradingMode" | "points">) {
  if (question.gradingMode === "RANKED") return "50 points for 1st · 30 for 2nd · 10 for 3rd · 0 below podium";
  if (question.gradingMode === "CLOSEST") return `${question.points} points · closest prediction wins`;
  return `${question.points} points`;
}

function PredictionControl({
  question,
  answer,
  playerName,
  onAnswer,
  onOpenPicker,
}: {
  question: Question;
  answer: string;
  playerName?: string;
  onAnswer: (answer: string) => void;
  onOpenPicker: () => void;
}) {
  if (["champion", "team", "player"].includes(question.answerType)) {
    return <button type="button" className={`crystal-choice-button${answer ? " selected" : ""}`} onClick={onOpenPicker}>
      <span className="crystal-choice-caption">Your prediction</span>
      {answer
        ? question.answerType === "champion"
          ? <ChampionLabel name={answer} size="md" />
          : question.answerType === "team"
            ? <TeamLabel name={answer} size="md" />
            : <span className="crystal-player-choice"><b>{playerName ?? answer}</b><small>Change player</small></span>
        : <span className="crystal-choice-placeholder">Choose a {question.answerType} <b aria-hidden="true">→</b></span>}
    </button>;
  }

  if (question.answerType === "number") {
    return <label className="crystal-number-control">
      <span>Your prediction</span>
      <input
        type="number"
        min={0}
        max={200}
        step={1}
        value={answer}
        onChange={(event) => onAnswer(event.target.value)}
        placeholder="Enter a whole number"
      />
    </label>;
  }

  const options = question.answerType === "yes_no"
    ? YES_NO_ANSWERS
    : question.answerType === "pentakill_bucket"
      ? PENTAKILL_ANSWERS
      : DRAKE_ANSWERS;
  return <div className="crystal-option-control">
    <span>Your prediction</span>
    <div className="crystal-inline-options">
      {options.map((option) => <button
        type="button"
        aria-pressed={answer === option}
        className={answer === option ? "selected" : ""}
        onClick={() => onAnswer(option)}
        key={option}
      >{option}</button>)}
    </div>
  </div>;
}

function PredictionPicker({
  picker,
  teams,
  players,
  champions,
  onChoose,
  onClose,
}: {
  picker: Picker;
  teams: string[];
  players: PlayerOption[];
  champions: string[];
  onChoose: (answer: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const playerTeams = useMemo(
    () => [...new Set([...teams, ...players.map((player) => player.team).filter((team): team is string => Boolean(team))])].sort(),
    [players, teams],
  );
  const [selectedTeam, setSelectedTeam] = useState(playerTeams[0] ?? "");

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const title = picker.type === "champion" ? "Choose a champion" : picker.type === "team" ? "Choose a team" : "Choose a player";
  const filteredChampions = champions.filter((champion) => champion.toLowerCase().includes(search.toLowerCase().trim()));
  const selectedPlayers = players.filter((player) => player.team === selectedTeam);

  return <div className="picker-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="picker-dialog" role="dialog" aria-modal="true" aria-labelledby="prediction-picker-title">
      <header className="picker-header">
        <div><h2 id="prediction-picker-title">{title}</h2><p>{picker.type === "player" ? "Pick a team, then choose a player by role." : "Scroll or search, then click your prediction."}</p></div>
        <button type="button" className="picker-close" onClick={onClose} aria-label="Close picker">×</button>
      </header>
      <div className="picker-body">
        {picker.type === "team" && <div className="team-picker-grid">
          {teams.map((team) => <button type="button" className="picker-option team-option" onClick={() => onChoose(team)} key={team}>
            <TeamLogo name={team} size="lg" /><b>{team}</b>
          </button>)}
        </div>}
        {picker.type === "champion" && <>
          <label className="picker-search"><span>Search champions</span><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Start typing…" /></label>
          <div className="champion-picker-grid">
            {filteredChampions.map((champion) => <button type="button" className="picker-option champion-option" onClick={() => onChoose(champion)} key={champion}>
              <ChampionIcon name={champion} size="lg" /><b>{champion}</b>
            </button>)}
          </div>
          {filteredChampions.length === 0 && <p className="empty-picker muted">No champions match “{search}”.</p>}
        </>}
        {picker.type === "player" && <>
          <div className="player-team-tabs" aria-label="Teams">
            {playerTeams.map((team) => <button type="button" aria-pressed={selectedTeam === team} className={selectedTeam === team ? "selected" : ""} onClick={() => setSelectedTeam(team)} key={team}>
              <TeamLogo name={team} size="sm" /><span>{team}</span>
            </button>)}
          </div>
          <div className="player-role-sections">
            {ROLE_GROUPS.map((role) => {
              const rolePlayers = selectedPlayers.filter((player) => normalizeRole(player.role) === role.key);
              return <section className="player-role-group" key={role.key}>
                <h3>{role.label}</h3>
                <div className="player-picker-grid">
                  {rolePlayers.map((player) => <button type="button" className="picker-option player-option" onClick={() => onChoose(player.value)} key={player.value}>
                    <b>{player.label}</b><small>{role.label}</small>
                  </button>)}
                  {rolePlayers.length === 0 && <span className="muted small">No {role.label.toLowerCase()} listed</span>}
                </div>
              </section>;
            })}
          </div>
        </>}
      </div>
    </section>
  </div>;
}
