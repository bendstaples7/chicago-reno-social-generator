import { useLocation } from 'react-router-dom';

export default function PlaceholderPage() {
  const { pathname } = useLocation();
  return (
    <div>
      <h1>{pathname.replace(/^\//, '').replace(/[-/]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</h1>
      <p>This page is under construction.</p>
    </div>
  );
}
