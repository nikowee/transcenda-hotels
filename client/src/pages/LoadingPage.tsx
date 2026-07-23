interface LoadingPageProps {
    message?: string;
    error?: string | null;
}

export default function LoadingPage({ message = 'Finding your perfect stay...', error = null }: LoadingPageProps) {
    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
            <div className="text-center space-y-4">
                <div className={error ? '' : 'animate-bounce'}>
                    <div
                        className={`h-16 w-16 rounded-full mx-auto flex items-center justify-center ${
                            error ? 'bg-red-100' : 'bg-blue-100'
                        }`}
                    >
                        <span className="text-3xl">{error ? '⚠️' : '🏨'}</span>
                    </div>
                </div>
                <h1 className="text-3xl font-bold text-slate-700">{message}</h1>

                {error && (
                    <p className="text-sm text-red-500 bg-red-50 rounded-lg px-4 py-2 inline-block">
                        {error}
                    </p>
                )}
            </div>
        </div>
    );
}