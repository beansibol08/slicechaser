#include "ChaseData.h"
#include "MiniJson.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <sys/stat.h>

#if defined( _WIN32 )
#	ifndef NOMINMAX
#		define NOMINMAX
#	endif
#	include <windows.h>
#	include <shlobj.h>
#	include <knownfolders.h>
#endif

namespace sc
{
//------------------------------------------------------------------ parsing

const Sequence* ChaseFile::FindSequence( int id ) const
{
	for( const auto& s : sequences )
		if( s.id == id )
			return &s;
	return nullptr;
}

bool ParseChaseJson( const std::string& text, ChaseFile& out, std::string& error )
{
	JValue root;
	JParser parser( text );
	if( !parser.Parse( root, error ) )
		return false;
	if( root.type != JValue::Object )
	{
		error = "chase file must be a JSON object";
		return false;
	}

	ChaseFile f;
	if( const JValue* comp = root.Find( "composition" ) )
	{
		f.compWidth  = (int)comp->NumberOr( "width", 0 );
		f.compHeight = (int)comp->NumberOr( "height", 0 );
	}

	if( const JValue* slices = root.Find( "slices" ) )
	{
		if( slices->type != JValue::Array )
		{
			error = "\"slices\" must be an array";
			return false;
		}
		for( const JValue& js : slices->arr )
		{
			Slice s;
			s.name   = js.StringOr( "name", "Slice" );
			s.aspect = (float)js.NumberOr( "aspect", 1.0 );
			if( !( s.aspect > 0.0001f ) || !std::isfinite( s.aspect ) )
				s.aspect = 1.0f;
			if( const JValue* v = js.Find( "verts" ) )
			{
				if( v->type == JValue::Array )
				{
					s.verts.reserve( v->arr.size() );
					for( const JValue& n : v->arr )
						s.verts.push_back( n.type == JValue::Number ? (float)n.number : 0.0f );
				}
			}
			// whole triangles only: 3 vertices * 4 floats
			s.verts.resize( s.verts.size() - s.verts.size() % 12 );
			f.slices.push_back( std::move( s ) );
		}
	}

	if( const JValue* seqs = root.Find( "sequences" ) )
	{
		if( seqs->type != JValue::Array )
		{
			error = "\"sequences\" must be an array";
			return false;
		}
		int fallbackId = 1;
		for( const JValue& jq : seqs->arr )
		{
			Sequence q;
			q.id   = (int)jq.NumberOr( "id", fallbackId );
			q.name = jq.StringOr( "name", "Sequence" );
			++fallbackId;
			if( const JValue* steps = jq.Find( "steps" ) )
			{
				if( steps->type == JValue::Array )
				{
					for( const JValue& st : steps->arr )
					{
						std::vector< int > on;
						if( st.type == JValue::Array )
						{
							for( const JValue& n : st.arr )
							{
								if( n.type != JValue::Number )
									continue;
								int idx = (int)n.number;
								if( idx >= 0 && idx < (int)f.slices.size() )
									on.push_back( idx );
							}
						}
						q.steps.push_back( std::move( on ) );
					}
				}
			}
			// ids must be unique for the option parameter; bump duplicates
			while( f.FindSequence( q.id ) )
				++q.id;
			f.sequences.push_back( std::move( q ) );
		}
	}

	out = std::move( f );
	return true;
}

//------------------------------------------------------------------ files

#if defined( _WIN32 )
static std::wstring Widen( const std::string& s )
{
	if( s.empty() )
		return std::wstring();
	int n = MultiByteToWideChar( CP_UTF8, 0, s.c_str(), (int)s.size(), nullptr, 0 );
	std::wstring w( (size_t)n, L'\0' );
	MultiByteToWideChar( CP_UTF8, 0, s.c_str(), (int)s.size(), &w[ 0 ], n );
	return w;
}
static std::string Narrow( const wchar_t* w )
{
	int n = WideCharToMultiByte( CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr );
	if( n <= 1 )
		return std::string();
	std::string s( (size_t)( n - 1 ), '\0' );
	WideCharToMultiByte( CP_UTF8, 0, w, -1, &s[ 0 ], n, nullptr, nullptr );
	return s;
}
#endif

std::string ChaseFilePath()
{
	if( const char* env = getenv( "SLICECHASER_FILE" ) )
		if( *env )
			return env;

	std::string docs;
#if defined( _WIN32 )
	// The Known Folder API follows OneDrive/Documents redirection, same as Electron's app.getPath("documents")
	PWSTR wpath = nullptr;
	if( SUCCEEDED( SHGetKnownFolderPath( FOLDERID_Documents, 0, nullptr, &wpath ) ) && wpath )
		docs = Narrow( wpath );
	if( wpath )
		CoTaskMemFree( wpath );
	if( docs.empty() )
	{
		if( const char* up = getenv( "USERPROFILE" ) )
			docs = std::string( up ) + "\\Documents";
	}
	return docs + "\\SliceChaser\\chases.json";
#else
	if( const char* home = getenv( "HOME" ) )
		docs = std::string( home ) + "/Documents";
	return docs + "/SliceChaser/chases.json";
#endif
}

static long long FileStamp( const std::string& path )
{
#if defined( _WIN32 )
	struct _stat64 st;
	if( _wstat64( Widen( path ).c_str(), &st ) != 0 )
		return -1;
	return (long long)st.st_mtime * 1000003LL ^ (long long)st.st_size;
#else
	struct stat st;
	if( stat( path.c_str(), &st ) != 0 )
		return -1;
	return (long long)st.st_mtime * 1000003LL ^ (long long)st.st_size;
#endif
}

static bool ReadWholeFile( const std::string& path, std::string& out )
{
#if defined( _WIN32 )
	FILE* fp = _wfopen( Widen( path ).c_str(), L"rb" );
#else
	FILE* fp = fopen( path.c_str(), "rb" );
#endif
	if( !fp )
		return false;
	out.clear();
	char buf[ 65536 ];
	size_t n;
	while( ( n = fread( buf, 1, sizeof( buf ), fp ) ) > 0 )
		out.append( buf, n );
	fclose( fp );
	return true;
}

//------------------------------------------------------------------ library

ChaseLibrary& ChaseLibrary::Get()
{
	static ChaseLibrary lib;
	return lib;
}

ChaseLibrary::ChaseLibrary() :
	path( ChaseFilePath() ),
	data( std::make_shared< ChaseFile >() )
{
}

std::shared_ptr< const ChaseFile > ChaseLibrary::Current( uint64_t* rev )
{
	std::lock_guard< std::mutex > lock( mutex );
	PollLocked( false );
	if( rev )
		*rev = revision;
	return data;
}

void ChaseLibrary::ForceReload( const std::string& newPath )
{
	std::lock_guard< std::mutex > lock( mutex );
	path      = newPath;
	lastStamp = -2;
	PollLocked( true );
}

void ChaseLibrary::PollLocked( bool force )
{
	auto now = std::chrono::steady_clock::now();
	if( !force && polledOnce && now - lastPoll < std::chrono::milliseconds( 500 ) )
		return;
	polledOnce = true;
	lastPoll   = now;

	long long stamp = FileStamp( path );
	if( !force && stamp == lastStamp )
		return;

	// The editor writes to a temp file and renames, but be defensive about
	// catching a half-written file: if parsing fails, keep the old data and retry later.
	std::string text;
	if( stamp < 0 || !ReadWholeFile( path, text ) )
	{
		if( lastStamp != -1 )
		{
			data      = std::make_shared< ChaseFile >();
			lastStamp = -1;
			++revision;
		}
		return;
	}
	auto fresh = std::make_shared< ChaseFile >();
	std::string error;
	if( !ParseChaseJson( text, *fresh, error ) )
		return;// lastStamp untouched so the next poll tries again

	data      = fresh;
	lastStamp = stamp;
	++revision;
}

//------------------------------------------------------------------ timing

float Envelope( float t, float sustain, float release )
{
	if( !( t >= 0.0f ) || t >= 1.0f )
		return 0.0f;
	if( release <= sustain )
		return t < sustain ? 1.0f : 0.0f;
	if( t < sustain )
		return 1.0f;
	if( t >= release )
		return 0.0f;
	return 1.0f - ( t - sustain ) / ( release - sustain );
}

void ChaserOpacities( const Sequence& seq, size_t sliceCount, float step01, int echoes, float sustain, float release,
                      bool reverse, std::vector< float >& out )
{
	out.assign( sliceCount, 0.0f );
	const int n = (int)seq.steps.size();
	if( n == 0 || sliceCount == 0 )
		return;
	echoes = std::max( 1, std::min( echoes, n ) );

	float x = std::min( std::max( step01, 0.0f ), 1.0f ) * (float)n;
	if( x >= (float)n )
		x = std::nextafter( (float)n, 0.0f );// Step at exactly 1.0 shows the last step
	int step   = (int)std::floor( x );
	float frac = x - (float)step;
	if( reverse )
		step = n - 1 - step;

	for( int k = 0; k < echoes; ++k )
	{
		// k steps ago: earlier step going forward, later step going backward
		int idx = reverse ? ( step + k ) % n : ( ( step - k ) % n + n ) % n;
		float o = Envelope( ( (float)k + frac ) / (float)echoes, sustain, release );
		if( o <= 0.0f )
			continue;
		for( int s : seq.steps[ idx ] )
			if( s >= 0 && (size_t)s < sliceCount )
				out[ s ] = std::max( out[ s ], o );
	}
}

double FadeSecondsFromSpeed( float speed01 )
{
	float s = std::min( std::max( speed01, 0.0f ), 1.0f );
	return 2.0 * std::pow( 0.02, (double)s );
}

double BlastIntervalFromSpeed( float speed01 )
{
	float s = std::min( std::max( speed01, 0.0f ), 1.0f );
	return 0.25 * std::pow( 0.1, (double)s );
}

double NowSeconds()
{
	using namespace std::chrono;
	static const steady_clock::time_point start = steady_clock::now();
	return duration< double >( steady_clock::now() - start ).count();
}

//------------------------------------------------------------------ bumper

void BumperState::Reset()
{
	current   = -1;
	blastLeft = 0;
	fired.clear();
}

void BumperState::Fire( const Sequence& seq, size_t sliceCount, int step, double now )
{
	if( fired.size() != sliceCount )
		fired.assign( sliceCount, -1e9 );
	for( int s : seq.steps[ step ] )
		if( s >= 0 && (size_t)s < sliceCount )
			fired[ s ] = now;
}

void BumperState::Next( const Sequence& seq, size_t sliceCount, double now, bool autoReset, double resetDelay )
{
	const int n = (int)seq.steps.size();
	if( n == 0 )
		return;
	if( autoReset && blastLeft == 0 && now - lastInput > resetDelay )
		current = -1;
	lastInput = now;
	current   = ( current + 1 ) % n;
	Fire( seq, sliceCount, current, now );
}

void BumperState::Previous( const Sequence& seq, size_t sliceCount, double now )
{
	const int n = (int)seq.steps.size();
	if( n == 0 )
		return;
	lastInput = now;
	current   = current <= 0 ? n - 1 : current - 1;
	Fire( seq, sliceCount, current, now );
}

void BumperState::StartBlast( const Sequence& seq, double now )
{
	if( seq.steps.empty() )
		return;
	blastLeft = (int)seq.steps.size();
	nextBlast = now;
	lastInput = now;
}

void BumperState::Update( const Sequence& seq, size_t sliceCount, double now, double blastInterval, double fadeSeconds,
                          float sustain, float release, std::vector< float >& out )
{
	const int n = (int)seq.steps.size();
	if( current >= n )
		current = -1;// sequence got shorter

	int guard = 0;
	while( blastLeft > 0 && n > 0 && now >= nextBlast && guard++ < 1000 )
	{
		current = ( current + 1 ) % n;
		Fire( seq, sliceCount, current, nextBlast );
		nextBlast += blastInterval;
		--blastLeft;
		lastInput = now;
	}

	out.assign( sliceCount, 0.0f );
	if( fired.size() != sliceCount )
		fired.assign( sliceCount, -1e9 );
	double dur = std::max( fadeSeconds, 1e-3 );
	for( size_t i = 0; i < sliceCount; ++i )
		out[ i ] = Envelope( (float)( ( now - fired[ i ] ) / dur ), sustain, release );
}

}//namespace sc
