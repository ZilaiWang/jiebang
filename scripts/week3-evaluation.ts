import { runWeek3Evaluation } from "../src/evaluation/week3-evaluation"

const report = await runWeek3Evaluation()
console.log(JSON.stringify(report, null, 2))
