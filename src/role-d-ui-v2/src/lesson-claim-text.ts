/** Remove claim text only when it is repeated as its own display line. */
export function stripStandaloneClaimText(
  bodyText: string,
  claims: Array<{ text: string }>,
): string {
  const claimTexts = new Set(
    claims.map((claim) => claim.text.trim()).filter(Boolean),
  )
  return bodyText
    .split(/\r?\n/u)
    .map((line) => {
      const trimmed = line.trim()
      const withoutLabel = trimmed.replace(/^证据事实[：:]\s*/u, "").trim()
      if (claimTexts.has(trimmed) || claimTexts.has(withoutLabel)) return ""
      const labelledParts = trimmed.startsWith("证据事实：")
        ? withoutLabel.split(/[；;]+/u).map((part) => part.trim()).filter(Boolean)
        : []
      if (labelledParts.length > 0
        && labelledParts.every((part) => claimTexts.has(part))) return ""
      return withoutLabel
    })
    .filter(Boolean)
    .join("\n")
    .trim()
}
