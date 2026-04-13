import Layout from '../components/Layout';

export default function PlaceholderPage({ title }) {
  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">{title}</h1>
      </div>
      <p className="text-muted" style={{ fontSize: 14 }}>Tato sekce se brzy zobrazí.</p>
    </Layout>
  );
}
