// Headless end-to-end test (Linux + Mesa): loads the real SliceChaser/SliceBumper binaries
// the way Resolume does, renders a gradient through them and checks the output pixels.
#define GLEW_STATIC
#define GLEW_NO_GLU
#include <GL/glew.h>// declarations only; the shim fills the function pointers
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <dlfcn.h>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <string>
#include <thread>
#include <vector>

extern "C" int shim_glew_load( void );

// --- minimal FFGL host-side definitions (values from FFGL.h)
typedef union
{
	uint32_t UIntValue;
	void* PointerValue;
} FFMixed;
typedef FFMixed ( *PlugMain )( uint32_t, FFMixed, void* );
struct Viewport { GLuint x, y, width, height; };
struct Texture { uint32_t Width, Height, HardwareWidth, HardwareHeight; GLuint Handle; };
struct ProcessGL { uint32_t numInputTextures; Texture** inputTextures; GLuint HostFBO; };
struct SetParam { uint32_t ParameterNumber; FFMixed NewParameterValue; };
struct ElemQuery { uint32_t ParameterNumber, ElementNumber; };
struct ParamEvent { uint32_t ParameterNumber; uint64_t eventFlags; };
struct GetEvents { uint32_t numEvents; ParamEvent* events; };
enum : uint32_t
{
	FF_DEINITIALISE = 2, FF_GET_NUM_PARAMETERS = 4, FF_GET_PARAMETER_NAME = 5, FF_SET_PARAMETER = 8,
	FF_GET_PARAMETER = 9, FF_PROCESS_OPENGL = 17, FF_INSTANTIATE_GL = 18, FF_DEINSTANTIATE_GL = 19,
	FF_GET_NUM_PARAMETER_ELEMENTS = 31, FF_INITIALISE_V2 = 34, FF_GET_PARAMETER_ELEMENT_NAME = 35,
	FF_GET_PARAMETER_ELEMENT_VALUE = 36, FF_GET_PARAMETER_EVENTS = 46
};


static int failures = 0;
#define CHECK( c ) do { if( !( c ) ) { std::printf( "FAIL line %d: %s\n", __LINE__, #c ); ++failures; } } while( 0 )

static const int W = 64, H = 32;

struct Plugin
{
	void* lib      = nullptr;
	PlugMain main  = nullptr;
	void* instance = nullptr;
	FFMixed Call( uint32_t code, FFMixed in ) { return main( code, in, instance ); }
	FFMixed CallU( uint32_t code, uint32_t v ) { FFMixed m; m.PointerValue = nullptr; m.UIntValue = v; return Call( code, m ); }
	FFMixed CallP( uint32_t code, void* p ) { FFMixed m; m.PointerValue = p; return Call( code, m ); }

	bool Load( const char* path )
	{
		lib = dlopen( path, RTLD_NOW | RTLD_LOCAL );
		if( !lib ) { std::printf( "dlopen: %s\n", dlerror() ); return false; }
		main = (PlugMain)dlsym( lib, "plugMain" );
		return main && CallU( FF_INITIALISE_V2, ( 2u << 16 ) | 1u ).UIntValue == 0;
	}
	bool Instantiate()
	{
		Viewport vp{ 0, 0, (GLuint)W, (GLuint)H };
		instance = CallP( FF_INSTANTIATE_GL, &vp ).PointerValue;
		return instance != nullptr && instance != (void*)1;// FF_FAIL is returned as pointer 1
	}
	int FindParam( const char* name )
	{
		int n = (int)CallU( FF_GET_NUM_PARAMETERS, 0 ).UIntValue;
		for( int i = 0; i < n; ++i )
			if( std::strcmp( (const char*)CallU( FF_GET_PARAMETER_NAME, (uint32_t)i ).PointerValue, name ) == 0 )
				return i;
		std::printf( "no param %s\n", name );
		++failures;
		return -1;
	}
	void Set( const char* name, float v )
	{
		SetParam sp;
		sp.ParameterNumber = (uint32_t)FindParam( name );
		std::memcpy( &sp.NewParameterValue.UIntValue, &v, 4 );
		CallP( FF_SET_PARAMETER, &sp );
	}
	float Get( const char* name )
	{
		uint32_t u = CallU( FF_GET_PARAMETER, (uint32_t)FindParam( name ) ).UIntValue;
		float f;
		std::memcpy( &f, &u, 4 );
		return f;
	}
	std::vector< std::pair< std::string, float > > Elements( const char* name )
	{
		std::vector< std::pair< std::string, float > > out;
		uint32_t p = (uint32_t)FindParam( name );
		uint32_t n = CallU( FF_GET_NUM_PARAMETER_ELEMENTS, p ).UIntValue;
		for( uint32_t e = 0; e < n; ++e )
		{
			ElemQuery q{ p, e };
			const char* nm = (const char*)CallP( FF_GET_PARAMETER_ELEMENT_NAME, &q ).PointerValue;
			uint32_t u     = CallP( FF_GET_PARAMETER_ELEMENT_VALUE, &q ).UIntValue;
			float f;
			std::memcpy( &f, &u, 4 );
			out.emplace_back( nm ? nm : "", f );
		}
		return out;
	}
	uint64_t EventFlags( const char* name )
	{
		ParamEvent buf[ 32 ];
		GetEvents ge{ 32, buf };
		CallP( FF_GET_PARAMETER_EVENTS, &ge );
		uint64_t flags = 0;
		int p          = FindParam( name );
		for( uint32_t i = 0; i < ge.numEvents; ++i )
			if( (int)buf[ i ].ParameterNumber == p )
				flags |= buf[ i ].eventFlags;
		return flags;
	}
};

static GLuint inputTex, outputTex, fbo;
static std::vector< unsigned char > pixels( W * H * 4 );

static void Render( Plugin& p )
{
	Texture in{ W, H, W, H, inputTex };
	Texture* ins[ 1 ] = { &in };
	glBindFramebuffer( GL_FRAMEBUFFER, fbo );
	glViewport( 0, 0, W, H );
	glClearColor( 1, 0, 1, 1 );// magenta: the plugin must clear it
	glClear( GL_COLOR_BUFFER_BIT );
	ProcessGL pg{ 1, ins, fbo };
	CHECK( p.CallP( FF_PROCESS_OPENGL, &pg ).UIntValue == 0 );
	glReadPixels( 0, 0, W, H, GL_RGBA, GL_UNSIGNED_BYTE, pixels.data() );
	glBindFramebuffer( GL_FRAMEBUFFER, 0 );
}
static const unsigned char* Px( int x, int y ) { return &pixels[ ( y * W + x ) * 4 ]; }
static bool Transparent( int x, int y ) { const unsigned char* p = Px( x, y ); return p[ 0 ] == 0 && p[ 1 ] == 0 && p[ 2 ] == 0 && p[ 3 ] == 0; }

// Input gradient: R follows x, B = 255, A = 255 (opaque, so premultiplied == straight)
static int InputR( int x ) { return (int)std::lround( x * 255.0 / ( W - 1 ) ); }

static void WriteChaseFile( const char* path, const char* seqName, int seqId )
{
	// Two slices: left half and right half of the composition.
	auto rect = []( float x0, float x1 ) {
		char b[ 256 ];
		std::snprintf( b, sizeof b, "[%g,0,0,0, %g,0,1,0, %g,1,1,1,  %g,0,0,0, %g,1,1,1, %g,1,0,1]", x0, x1, x1, x0, x1,
		               x0 );
		return std::string( b );
	};
	std::ofstream f( path );
	f << "{\"version\":1,\"composition\":{\"width\":64,\"height\":32},\"slices\":["
	  << "{\"name\":\"L\",\"aspect\":1.0,\"verts\":" << rect( 0.0f, 0.5f ) << "},"
	  << "{\"name\":\"R\",\"aspect\":1.0,\"verts\":" << rect( 0.5f, 1.0f ) << "}],"
	  << "\"sequences\":[{\"id\":" << seqId << ",\"name\":\"" << seqName << "\",\"steps\":[[0],[1]]},"
	  << "{\"id\":9,\"name\":\"Both\",\"steps\":[[0,1]]}]}";
}

int main( int argc, char** argv )
{
	if( argc < 3 ) { std::printf( "usage: gl_host SliceChaser.so SliceBumper.so\n" ); return 2; }
	const char* chasePath = "gl_host_chases.json";
	WriteChaseFile( chasePath, "Left Right", 7 );
	setenv( "SLICECHASER_FILE", chasePath, 1 );

	// --- headless GL 4.1 core context
	auto getPlatformDisplay = (PFNEGLGETPLATFORMDISPLAYEXTPROC)eglGetProcAddress( "eglGetPlatformDisplayEXT" );
	EGLDisplay dpy = getPlatformDisplay ? getPlatformDisplay( EGL_PLATFORM_SURFACELESS_MESA, EGL_DEFAULT_DISPLAY, nullptr )
	                                    : eglGetDisplay( EGL_DEFAULT_DISPLAY );
	if( !eglInitialize( dpy, nullptr, nullptr ) ) { std::printf( "eglInitialize failed\n" ); return 2; }
	eglBindAPI( EGL_OPENGL_API );
	EGLint cfgAttr[] = { EGL_RENDERABLE_TYPE, EGL_OPENGL_BIT, EGL_SURFACE_TYPE, 0, EGL_NONE };
	EGLConfig cfg;
	EGLint nCfg = 0;
	eglChooseConfig( dpy, cfgAttr, &cfg, 1, &nCfg );
	EGLint ctxAttr[] = { EGL_CONTEXT_MAJOR_VERSION, 4, EGL_CONTEXT_MINOR_VERSION, 1, EGL_CONTEXT_OPENGL_PROFILE_MASK,
		                 EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT, EGL_NONE };
	EGLContext ctx = eglCreateContext( dpy, nCfg ? cfg : nullptr, EGL_NO_CONTEXT, ctxAttr );
	if( !ctx || !eglMakeCurrent( dpy, EGL_NO_SURFACE, EGL_NO_SURFACE, ctx ) ) { std::printf( "no GL 4.1 context\n" ); return 2; }
	std::printf( "GL: %s | %s\n", glGetString( GL_VERSION ), glGetString( GL_RENDERER ) );
	if( shim_glew_load() != 0 ) return 2;

	// --- input gradient + output target
	std::vector< unsigned char > grad( W * H * 4 );
	for( int y = 0; y < H; ++y )
		for( int x = 0; x < W; ++x )
		{
			unsigned char* p = &grad[ ( y * W + x ) * 4 ];
			p[ 0 ] = (unsigned char)InputR( x ); p[ 1 ] = (unsigned char)( y * 255 / ( H - 1 ) ); p[ 2 ] = 255; p[ 3 ] = 255;
		}
	glGenTextures( 1, &inputTex );
	glBindTexture( GL_TEXTURE_2D, inputTex );
	glTexImage2D( GL_TEXTURE_2D, 0, GL_RGBA8, W, H, 0, GL_RGBA, GL_UNSIGNED_BYTE, grad.data() );
	glTexParameteri( GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST );
	glTexParameteri( GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST );
	glGenTextures( 1, &outputTex );
	glBindTexture( GL_TEXTURE_2D, outputTex );
	glTexImage2D( GL_TEXTURE_2D, 0, GL_RGBA8, W, H, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr );
	glBindTexture( GL_TEXTURE_2D, 0 );
	glGenFramebuffers( 1, &fbo );
	glBindFramebuffer( GL_FRAMEBUFFER, fbo );
	glFramebufferTexture2D( GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, outputTex, 0 );
	CHECK( glCheckFramebufferStatus( GL_FRAMEBUFFER ) == GL_FRAMEBUFFER_COMPLETE );
	glBindFramebuffer( GL_FRAMEBUFFER, 0 );

	//================================================= SliceChaser
	Plugin chaser;
	CHECK( chaser.Load( argv[ 1 ] ) );
	CHECK( chaser.Instantiate() );

	auto seqs = chaser.Elements( "Sequence" );
	CHECK( seqs.size() == 2 );
	CHECK( seqs.size() == 2 && seqs[ 0 ].first == "Left Right" && seqs[ 0 ].second == 7.0f );
	CHECK( chaser.Get( "Sequence" ) == 7.0f );// defaults to the first sequence
	auto scal = chaser.Elements( "Scaling" );
	CHECK( scal.size() == 3 && scal[ 1 ].first == "Mask" );
	CHECK( chaser.Get( "Echoes" ) == 1.0f );

	// Mask mode, hard cut: step 0 shows only the left half, untouched
	chaser.Set( "Scaling", 1.0f );
	chaser.Set( "Sustain", 1.0f );
	chaser.Set( "Release", 1.0f );
	chaser.Set( "Step", 0.1f );
	Render( chaser );
	CHECK( Px( 5, 10 )[ 0 ] == InputR( 5 ) && Px( 5, 10 )[ 3 ] == 255 );
	CHECK( Px( 31, 10 )[ 0 ] == InputR( 31 ) );
	CHECK( Transparent( 40, 10 ) );
	CHECK( Transparent( 63, 31 ) );

	// Step into the second half: right slice only
	chaser.Set( "Step", 0.6f );
	Render( chaser );
	CHECK( Transparent( 5, 10 ) );
	CHECK( Px( 40, 10 )[ 0 ] == InputR( 40 ) && Px( 40, 10 )[ 3 ] == 255 );

	// Fade: half way through a step with sustain 0 / release 1 -> ~50% (premultiplied)
	chaser.Set( "Sustain", 0.0f );
	chaser.Set( "Release", 1.0f );
	chaser.Set( "Step", 0.25f );
	Render( chaser );
	CHECK( std::abs( Px( 5, 10 )[ 3 ] - 128 ) <= 2 );
	CHECK( std::abs( Px( 5, 10 )[ 2 ] - 128 ) <= 2 );// blue 255 * 0.5

	// Fill mode: a square slice (aspect 1) in 2:1 content samples the middle half of the image
	chaser.Set( "Scaling", 0.0f );
	chaser.Set( "Sustain", 1.0f );
	chaser.Set( "Release", 1.0f );
	chaser.Set( "Step", 0.0f );
	Render( chaser );
	int r0 = Px( 0, 16 )[ 0 ], r31 = Px( 31, 16 )[ 0 ];
	std::printf( "fill: left edge R=%d (expect ~%d), right edge R=%d (expect ~%d)\n", r0, InputR( 16 ), r31, InputR( 47 ) );
	CHECK( std::abs( r0 - InputR( 16 ) ) <= 6 );
	CHECK( std::abs( r31 - InputR( 47 ) ) <= 6 );
	CHECK( Transparent( 40, 16 ) );

	// Stretch mode: the whole image squeezed into the left half
	chaser.Set( "Scaling", 2.0f );
	Render( chaser );
	CHECK( std::abs( Px( 0, 16 )[ 0 ] - 0 ) <= 6 );
	CHECK( std::abs( Px( 31, 16 )[ 0 ] - 255 ) <= 6 );

	// Echoes 2: at the start of step 1, step 0 is still half visible
	chaser.Set( "Scaling", 1.0f );
	chaser.Set( "Sustain", 0.0f );
	chaser.Set( "Release", 1.0f );
	chaser.Set( "Echoes", 2.0f );
	chaser.Set( "Step", 0.5f );
	Render( chaser );
	CHECK( Px( 40, 10 )[ 3 ] == 255 );
	CHECK( std::abs( Px( 5, 10 )[ 3 ] - 128 ) <= 2 );
	chaser.Set( "Echoes", 1.0f );

	// Hot reload: rename and re-id the first sequence while the plugin runs
	chaser.EventFlags( "Sequence" );// drain
	std::this_thread::sleep_for( std::chrono::milliseconds( 1100 ) );// mtime granularity + 0.5 s poll
	WriteChaseFile( chasePath, "Renamed", 12 );
	std::this_thread::sleep_for( std::chrono::milliseconds( 600 ) );
	Render( chaser );
	seqs = chaser.Elements( "Sequence" );
	CHECK( seqs.size() == 2 && seqs[ 0 ].first == "Renamed" && seqs[ 0 ].second == 12.0f );
	uint64_t ev = chaser.EventFlags( "Sequence" );
	CHECK( ev & 0x08 );// elements changed
	CHECK( ev & 0x04 );// value changed: old id 7 is gone, so it moved to the first sequence
	CHECK( chaser.Get( "Sequence" ) == 12.0f );

	// Picking "Both" lights both halves on every step
	chaser.Set( "Sequence", 9.0f );
	chaser.Set( "Sustain", 1.0f );
	Render( chaser );
	CHECK( !Transparent( 5, 10 ) && !Transparent( 40, 10 ) );

	CHECK( chaser.CallU( FF_DEINSTANTIATE_GL, 0 ).UIntValue == 0 );

	//================================================= SliceBumper
	Plugin bumper;
	CHECK( bumper.Load( argv[ 2 ] ) );
	CHECK( bumper.Instantiate() );
	bumper.Set( "Scaling", 1.0f );
	bumper.Set( "Fade Speed", 0.0f );// 2 s fade so timing is stable
	Render( bumper );
	CHECK( Transparent( 5, 10 ) && Transparent( 40, 10 ) );// nothing until tapped
	bumper.Set( "Next", 1.0f );
	bumper.Set( "Next", 0.0f );
	Render( bumper );
	CHECK( !Transparent( 5, 10 ) && Transparent( 40, 10 ) );
	bumper.Set( "Next", 1.0f );
	bumper.Set( "Next", 0.0f );
	Render( bumper );
	CHECK( !Transparent( 40, 10 ) );// right slice fired; left still fading out
	bumper.Set( "Fade Speed", 1.0f );// 40 ms fade
	std::this_thread::sleep_for( std::chrono::milliseconds( 100 ) );
	Render( bumper );
	CHECK( Transparent( 5, 10 ) && Transparent( 40, 10 ) );
	bumper.Set( "Blast", 1.0f );
	bumper.Set( "Blast", 0.0f );
	bumper.Set( "Fade Speed", 0.0f );
	Render( bumper );
	CHECK( !Transparent( 5, 10 ) );// blast fires the first step immediately
	CHECK( bumper.CallU( FF_DEINSTANTIATE_GL, 0 ).UIntValue == 0 );

	chaser.CallU( FF_DEINITIALISE, 0 );
	bumper.CallU( FF_DEINITIALISE, 0 );
	std::remove( chasePath );
	if( failures == 0 )
		std::printf( "All GL tests passed\n" );
	return failures ? 1 : 0;
}
