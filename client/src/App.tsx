import { useState } from 'react'
import { Search } from 'lucide-react'

export default function App() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6 text-center">
      {/* Visual Indicator Container */}
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg shadow-blue-200">
        <Search className="h-8 w-8" />
      </div>
      
      {/* Typographic Title Element */}
      <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-slate-900">
        Trancenda Hotels Architecture Active
      </h1>
      
      {/* Explanatory Boundary Copy */}
      <p className="mt-2 text-slate-600 max-w-sm">
        Tailwind v4, React SWC, and Lucide icons are manually wired and completely responsive.
      </p>
    </div>
  )
}