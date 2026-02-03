import { Routes, Route } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { Home } from './pages/Home'

function App() {
    return (
        <Routes>
            <Route path="/" element={<AppShell />}>
                <Route index element={<Home />} />
            </Route>
        </Routes>
    )
}

export default App
