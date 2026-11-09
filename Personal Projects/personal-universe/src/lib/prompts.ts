// Built-in student prompt library. Seeded once into the local database, after which every
// prompt is the user's to edit, duplicate or delete.
import { batch, q1 } from "./backend";
import { useSettings } from "./hooks";

const P = (subject: string, title: string, body: string) => ({ subject, title, body });
const M = "the attached material";

export const BUILTIN = [
  P("General", "Break the problem into universal steps", `Using ${M}, break this problem down into a sequence of steps that would work for ANY problem of the same type.\n\nFor each step: name it, say what it achieves, and state the cue that tells me this step is needed. Then apply the steps to this specific problem so I can see the general method and the concrete case side by side.`),
  P("General", "Explain from first principles", `Explain the central concept in ${M} from first principles.\n\nStart from what I can be assumed to know already, define every new term before using it, build up one idea at a time, and show why each idea must be true rather than asking me to accept it. Finish with a three-sentence summary and one question that tests real understanding.`),
  P("General", "Identify givens and unknowns", `Read ${M} and, before solving anything:\n1. List every piece of given information with its symbol and unit.\n2. State exactly what must be found.\n3. List the implicit assumptions and constraints.\n4. Point out any information that is irrelevant or a deliberate distraction.\nDo not solve the problem yet.`),
  P("General", "Teach me to recognise the method", `Teach me how to recognise which method applies to problems like those in ${M}.\n\nGive me a decision guide: the features to look for in the question, which method each feature points to, and the common look-alike situations where the obvious method is wrong. Then give three short problems and ask me to choose the method (without solving) before you reveal the answer.`),
  P("General", "Solve step by step", `Solve the problem in ${M} step by step.\n\nNumber the steps. In each one state the goal, the rule or formula used, and the working. Carry units throughout and box the final answer. After the solution, verify the answer by an independent check (limiting case, substitution or dimensional analysis).`),
  P("General", "Explain every equation and transformation", `Go through ${M} line by line. For every equation and every algebraic transformation, explain what was done, which rule justifies it, and why it was a useful move at that point. Flag any step where a condition must hold for the manipulation to be valid.`),
  P("General", "Identify common mistakes", `Based on ${M}, list the mistakes students most often make on this topic.\n\nFor each mistake: show a short example of it, explain the misconception behind it, show the correct approach, and give a quick self-check that would catch it in an exam.`),
  P("General", "Generate similar practice problems", `Create six practice problems modelled on ${M}: two easier, two at the same level and two harder. Vary the surface details so that I must recognise the underlying method. Give the problems first; put fully worked solutions at the end under a clear separator so I can attempt them before looking.`),
  P("General", "Quiz me with active recall", `Quiz me on ${M} using active recall.\n\nAsk one question at a time and wait for my answer. Mix definitions, "why" questions and short applications. After each answer tell me what was right, what was missing, and the ideal answer in two sentences. Revisit anything I get wrong later in the session. Start now with question 1.`),
  P("General", "Create revision notes", `Turn ${M} into concise revision notes.\n\nUse headings, key definitions, the essential formulas with the meaning of every symbol, one worked example per idea, and a final "must remember" list of no more than seven points. Keep it compact enough to revise in fifteen minutes.`),
  P("General", "Extract formulas and their applications", `Extract every formula from ${M} into a table with columns: formula, meaning of each symbol with units, when it applies, when it does NOT apply, and a one-line example of its use. Group related formulas and show how they derive from each other where relevant.`),
  P("General", "Compare concepts", `Compare the main concepts in ${M}.\n\nGive a comparison table (definition, purpose, key equations, typical use, limitations), then explain in prose how to tell them apart in a problem and where students most often confuse them.`),
  P("General", "Explain code line by line", `Explain the code in ${M} line by line.\n\nFirst summarise what the program does and its overall structure. Then walk through it in order: what each line or block does, why it is needed, and the state of the important variables at that point. Finish with time/space complexity, edge cases, and anything that is a bug or poor practice.`),
  P("General", "Review my solution", `Attached is my own attempt. Review it as a strict but supportive examiner.\n\nGo through my working in order. Mark each step correct or incorrect; where it is wrong, explain the error and the misconception behind it, but give me a hint first rather than the full fix. End with the marks I would likely lose and what to practise.`),
  P("General", "Exam-oriented revision material", `Prepare exam-oriented revision material from ${M}.\n\nInclude: the topics most likely to be examined and in what form, model answers for two typical long questions, a list of short-answer points, the formulas to memorise, and a timed mini-test (with a marking scheme) that I can attempt in thirty minutes.`),

  P("Mathematics", "Proof walkthrough", `Walk me through the proof or derivation in ${M}. State what is being proved, the strategy, and then each step with its justification. Point out which step is the key idea, and show a small numerical example that illustrates the result.`),
  P("Mathematics", "Method selection for integrals and ODEs", `For each problem in ${M}, identify the technique required (substitution, parts, partial fractions, integrating factor, characteristic equation, Laplace, and so on), explain the clue that points to it, then solve it showing every line.`),
  P("Mathematics", "Check my working", `Check my mathematical working in ${M} line by line. Find the first line where an error occurs, explain it, and show the corrected continuation. Also verify the final answer independently.`),

  P("Electrical Engineering", "Circuit analysis strategy", `For the circuit in ${M}: describe the circuit in words, choose the most efficient analysis method (nodal, mesh, superposition, Thevenin/Norton, phasors) and justify the choice, then solve step by step with units and sign conventions stated. Finish with a sanity check using power balance or a limiting case.`),
  P("Electrical Engineering", "Signals & systems intuition", `Explain the signals-and-systems concept in ${M} with physical intuition first and mathematics second. Relate the time-domain and frequency-domain views, sketch (in words) what the plots look like, and list the transform pairs or properties I should memorise.`),
  P("Electrical Engineering", "Control systems design review", `Using ${M}, explain the control problem: the plant, the specifications, and the design approach (root locus, Bode, PID tuning, state feedback). Show how each specification maps to a constraint, carry out the design, and comment on stability margins and practical limitations.`),
  P("Electrical Engineering", "Lab report helper", `Help me turn the lab material in ${M} into a clear report: objective, theory in my own words, procedure, results table, analysis of the difference between theory and measurement with likely sources of error, and a conclusion. Do not invent measurements — ask me for any value that is missing.`),

  P("Computer Science", "Algorithm deep dive", `Explain the algorithm or data structure in ${M}: the problem it solves, the core idea, a step-by-step trace on a small example, correctness argument, time and space complexity with justification, and how it compares with the alternatives.`),
  P("Computer Science", "Operating systems concept map", `Explain the operating-systems topic in ${M} (for example scheduling, synchronisation, memory management). Define the terms, walk through a concrete scenario with a timeline or table, and list the classic exam questions with how to answer them.`),

  P("Databases", "Normalisation step by step", `Using the schema or data in ${M}: list the functional dependencies, find the candidate keys, and normalise step by step to 1NF, 2NF, 3NF and BCNF. At each stage state which rule is violated and why the decomposition fixes it, and confirm it is lossless.`),
  P("Databases", "Write and explain the SQL", `For the requirements in ${M}, write the SQL queries. For each query explain the logic clause by clause, state any assumptions about the schema, and mention an alternative formulation and which is likely to perform better.`),
  P("Databases", "ER diagram critique", `Review the ER design described in ${M}. Identify entities, attributes, keys, relationships and cardinalities; point out ambiguities or modelling mistakes; then give the corrected relational schema.`),

  P("Machine Learning", "Model intuition and maths", `Explain the machine-learning method in ${M}: the intuition, the objective function, how it is optimised (derive the update where practical), the hyperparameters and what each controls, the assumptions, and when the method fails.`),
  P("Machine Learning", "Experiment review", `Review the experiment or results in ${M}. Assess the data split, metrics, baselines and risk of leakage or overfitting. Tell me what the results do and do not show, and suggest the three most informative next experiments.`),
  P("Machine Learning", "Derive it from scratch", `Derive the algorithm in ${M} from scratch, stating each assumption. Then give minimal, well-commented NumPy pseudocode that implements exactly what was derived.`),

  P("Programming", "Debug with me", `The code in ${M} does not behave as expected. Reason about it systematically: restate the intended behaviour, trace the execution with a concrete input, identify where actual and expected state diverge, explain the root cause, and propose the smallest fix. Then suggest a test that would have caught it.`),
  P("Programming", "Refactor and explain why", `Suggest a refactoring of the code in ${M} for readability and correctness without changing behaviour. Show the revised code and explain each change and the principle behind it. Keep the same language and style conventions.`),
  P("Programming", "Write test cases", `Design test cases for the code in ${M}: normal cases, boundary cases and invalid input. Present them as a table of input, expected output and what each case is checking, then write them in the appropriate test framework.`),

  P("Technical Writing", "Improve clarity", `Edit the text in ${M} for clarity and concision while keeping my meaning and voice. Show the revised text, then list the main changes and the reason for each. Do not add claims or facts that are not in the original.`),
  P("Technical Writing", "Structure a report", `Propose a structure for a technical report based on ${M}: section headings, the purpose of each section, the key points and figures that belong in each, and what is currently missing. Then draft the abstract.`),
  P("Technical Writing", "Summarise a paper", `Summarise the paper in ${M}: the problem, why it matters, the method, the main results with numbers, the limitations the authors admit and those they do not, and how it relates to what I am studying. Finish with five questions I should be able to answer after reading it.`),
];

export async function seedPrompts() {
  if (useSettings.getState().values.promptsSeeded) return;
  const have = await q1<{ n: number }>("SELECT COUNT(*) n FROM prompts");
  if (!have?.n) {
    const now = Date.now();
    await batch(BUILTIN.map((p) => ({ sql: "INSERT INTO prompts(title, body, subject, builtin, updated_at) VALUES(?,?,?,1,?)", params: [p.title, p.body, p.subject, now] })));
  }
  await useSettings.getState().put("promptsSeeded", true);
}
export const SUBJECTS = ["General", "Mathematics", "Electrical Engineering", "Computer Science", "Databases", "Machine Learning", "Programming", "Technical Writing"];
