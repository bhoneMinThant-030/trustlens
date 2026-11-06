/*
  The red summary card on the dashboard, after the one in the OCBC app:
  a heading, one big number, a sentence, then a row of small figures.
*/
function Hero({ overline, value, unit, text, stats }) {
  return (
    <div className="bo-hero">
      <p className="bo-hero-overline">{overline}</p>
      <p className="bo-hero-value">
        {value}
        {unit && <span>{unit}</span>}
      </p>
      <p className="bo-hero-text">{text}</p>
      <dl className="bo-hero-stats">
        {stats.map((stat) => (
          <div key={stat.label}>
            <dt>{stat.label}</dt>
            <dd>{stat.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export default Hero
