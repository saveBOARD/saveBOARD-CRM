// List-page header from the ERP design: title on the left, actions on the right, 4px primary rule underneath.
export function PageHeader({ title, actions }: { title: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3 border-b-4 border-primary pb-2">
      <h1 className="text-xl font-medium">{title}</h1>
      <div className="ml-auto flex items-center gap-2">{actions}</div>
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="card p-5 text-sm text-muted">{children}</p>;
}
