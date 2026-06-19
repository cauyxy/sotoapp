export function PageHeader({
  kicker,
  title,
  sub,
}: {
  kicker?: string;
  title: string;
  sub?: string;
}): JSX.Element {
  return (
    <header className="page-header">
      {kicker ? <div className="kicker">{kicker}</div> : null}
      <div className="title-line">
        <h1>{title}</h1>
      </div>
      {sub ? <p>{sub}</p> : null}
    </header>
  );
}
