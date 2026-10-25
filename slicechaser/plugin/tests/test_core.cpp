// Unit tests for the GL-free parts: chase file parsing, hot reload, chaser and bumper timing.
#include "ChaseData.h"
#include <cmath>
#include <cstdio>
#include <fstream>
#include <string>
#include <clocale>

static int failures = 0;
#define CHECK( cond )                                                    \
	do                                                                   \
	{                                                                    \
		if( !( cond ) )                                                  \
		{                                                                \
			std::printf( "FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond ); \
			++failures;                                                  \
		}                                                                \
	} while( 0 )
#define NEAR( a, b ) CHECK( std::fabs( ( a ) - ( b ) ) < 1e-4 )

static const char* kFile = R"({
  "version": 1,
  "composition": { "width": 1920, "height": 1080 },
  "slices": [
    { "name": "Left",   "aspect": 1.5, "verts": [0,0,0,0, 0.5,0,1,0, 0.5,1,1,1,  0,0,0,0, 0.5,1,1,1, 0,1,0,1] },
    { "name": "Right é", "aspect": 1.5, "verts": [0.5,0,0,0, 1,0,1,0, 1,1,1,1, 7] },
    { "name": "Mid", "verts": [] }
  ],
  "sequences": [
    { "id": 4, "name": "L to R", "steps": [[0],[1],[2]] },
    { "id": 4, "name": "dupe id", "steps": [[0,1,99,-1]] },
    { "name": "no id", "steps": [] }
  ]
})";

static sc::Sequence Seq( std::vector< std::vector< int > > steps )
{
	sc::Sequence s;
	s.steps = std::move( steps );
	return s;
}

int main()
{
	// Simulate a host that switched to a decimal-comma locale.
	std::setlocale( LC_ALL, "de_DE.UTF-8" );

	//---------------------------------------------------------- parsing
	{
		sc::ChaseFile f;
		std::string err;
		CHECK( sc::ParseChaseJson( kFile, f, err ) );
		CHECK( f.compWidth == 1920 && f.compHeight == 1080 );
		CHECK( f.slices.size() == 3 );
		CHECK( f.slices[ 0 ].verts.size() == 24 );
		CHECK( f.slices[ 1 ].verts.size() == 12 );// stray float dropped
		NEAR( f.slices[ 0 ].verts[ 4 ], 0.5f );   // locale-independent decimals
		NEAR( f.slices[ 0 ].aspect, 1.5f );
		NEAR( f.slices[ 2 ].aspect, 1.0f );
		CHECK( f.slices[ 1 ].name == "Right \xC3\xA9" );
		CHECK( f.sequences.size() == 3 );
		CHECK( f.sequences[ 0 ].id == 4 );
		CHECK( f.sequences[ 1 ].id == 5 );// duplicate id bumped
		CHECK( f.sequences[ 1 ].steps[ 0 ].size() == 2 );// out-of-range slice indices dropped
		CHECK( f.FindSequence( 5 ) == &f.sequences[ 1 ] );
		CHECK( f.FindSequence( 42 ) == nullptr );

		sc::ChaseFile bad;
		CHECK( !sc::ParseChaseJson( "{\"slices\": [", bad, err ) );
		CHECK( !sc::ParseChaseJson( "[1,2]", bad, err ) );
		CHECK( sc::ParseChaseJson( "{\"x\": -1.25e2}", bad, err ) );
	}

	//---------------------------------------------------------- envelope
	NEAR( sc::Envelope( 0.0f, 0.2f, 0.8f ), 1.0f );
	NEAR( sc::Envelope( 0.19f, 0.2f, 0.8f ), 1.0f );
	NEAR( sc::Envelope( 0.5f, 0.2f, 0.8f ), 0.5f );
	NEAR( sc::Envelope( 0.8f, 0.2f, 0.8f ), 0.0f );
	NEAR( sc::Envelope( 0.95f, 0.2f, 0.8f ), 0.0f );
	NEAR( sc::Envelope( 0.99f, 1.0f, 1.0f ), 1.0f );// both 1.0: hard cut at end of step
	NEAR( sc::Envelope( 0.5f, 0.0f, 1.0f ), 0.5f );
	NEAR( sc::Envelope( 1.0f, 1.0f, 1.0f ), 0.0f );
	NEAR( sc::Envelope( -0.1f, 0.2f, 0.8f ), 0.0f );

	//---------------------------------------------------------- chaser
	{
		auto seq = Seq( { { 0 }, { 1 }, { 2 }, { 3 } } );
		std::vector< float > o;
		sc::ChaserOpacities( seq, 4, 0.0f, 1, 0.2f, 0.8f, false, o );
		NEAR( o[ 0 ], 1.0f );
		NEAR( o[ 1 ], 0.0f );
		sc::ChaserOpacities( seq, 4, 0.25f + 0.125f, 1, 0.2f, 0.8f, false, o );// half way through step 1
		NEAR( o[ 1 ], 0.5f );
		NEAR( o[ 0 ], 0.0f );
		sc::ChaserOpacities( seq, 4, 1.0f, 1, 1.0f, 1.0f, false, o );// exactly 1.0 = last step
		NEAR( o[ 3 ], 1.0f );
		sc::ChaserOpacities( seq, 4, 0.0f, 1, 1.0f, 1.0f, true, o );// reverse starts at the end
		NEAR( o[ 3 ], 1.0f );
		NEAR( o[ 0 ], 0.0f );

		// Echoes: at the start of step 1 with 2 echoes, step 0 is half way through its window
		sc::ChaserOpacities( seq, 4, 0.25f, 2, 0.0f, 1.0f, false, o );
		NEAR( o[ 1 ], 1.0f );
		NEAR( o[ 0 ], 0.5f );
		NEAR( o[ 3 ], 0.0f );
		// Echo wraps around the loop
		sc::ChaserOpacities( seq, 4, 0.0f, 2, 0.0f, 1.0f, false, o );
		NEAR( o[ 3 ], 0.5f );
		// Reverse echo trails the other way
		sc::ChaserOpacities( seq, 4, 0.25f, 2, 0.0f, 1.0f, true, o );// reverse step 2 now, step 3 echoing
		NEAR( o[ 2 ], 1.0f );
		NEAR( o[ 3 ], 0.5f );
		// Echoes clamp to sequence length; a slice in several echo windows takes the max
		auto all = Seq( { { 0 }, { 0 } } );
		sc::ChaserOpacities( all, 1, 0.75f, 9, 0.0f, 1.0f, false, o );
		NEAR( o[ 0 ], 1.0f - 0.5f / 2.0f );
		// Empty sequence and empty slices are safe
		sc::ChaserOpacities( Seq( {} ), 3, 0.5f, 1, 0.2f, 0.8f, false, o );
		CHECK( o.size() == 3 && o[ 0 ] == 0.0f );
	}

	//---------------------------------------------------------- bumper
	{
		auto seq = Seq( { { 0 }, { 1 }, { 2 } } );
		sc::BumperState b;
		std::vector< float > o;
		b.Next( seq, 3, 10.0, true, 2.0 );
		CHECK( b.CurrentStep() == 0 );
		b.Update( seq, 3, 10.0, 0.1, 1.0, 0.2f, 0.8f, o );
		NEAR( o[ 0 ], 1.0f );
		NEAR( o[ 1 ], 0.0f );
		b.Update( seq, 3, 10.5, 0.1, 1.0, 0.2f, 0.8f, o );
		NEAR( o[ 0 ], 0.5f );
		b.Next( seq, 3, 11.0, true, 2.0 );
		CHECK( b.CurrentStep() == 1 );
		b.Previous( seq, 3, 11.1 );
		CHECK( b.CurrentStep() == 0 );
		b.Previous( seq, 3, 11.2 );
		CHECK( b.CurrentStep() == 2 );// wraps backwards
		// No input for longer than the reset delay: the next tap starts over
		b.Next( seq, 3, 20.0, true, 2.0 );
		CHECK( b.CurrentStep() == 0 );
		// ...unless auto reset is off
		b.Next( seq, 3, 30.0, false, 2.0 );
		CHECK( b.CurrentStep() == 1 );

		// Blast: plays every step once, spaced by the interval
		sc::BumperState bl;
		bl.StartBlast( seq, 0.0 );
		bl.Update( seq, 3, 0.0, 0.1, 1.0, 0.2f, 0.8f, o );
		CHECK( bl.CurrentStep() == 0 );
		bl.Update( seq, 3, 0.25, 0.1, 1.0, 0.2f, 0.8f, o );
		CHECK( bl.CurrentStep() == 2 );
		NEAR( o[ 2 ], 1.0f );
		bl.Update( seq, 3, 5.0, 0.1, 1.0, 0.2f, 0.8f, o );
		CHECK( bl.CurrentStep() == 2 );// stopped after one pass

		// Sequence shrinking under the bumper doesn't crash
		auto shortSeq = Seq( { { 0 } } );
		b.Update( shortSeq, 1, 31.0, 0.1, 1.0, 0.2f, 0.8f, o );
		CHECK( o.size() == 1 );

		NEAR( sc::FadeSecondsFromSpeed( 0.0f ), 2.0 );
		NEAR( sc::FadeSecondsFromSpeed( 1.0f ), 0.04 );
		NEAR( sc::BlastIntervalFromSpeed( 1.0f ), 0.025 );
	}

	//---------------------------------------------------------- hot reload
	{
		const char* path = "slicechaser_test.json";
		std::remove( path );
		auto& lib = sc::ChaseLibrary::Get();
		uint64_t r0 = 0, r1 = 0, r2 = 0;
		lib.ForceReload( path );
		auto empty = lib.Current( &r0 );
		CHECK( empty->slices.empty() );

		{
			std::ofstream( path ) << kFile;
		}
		lib.ForceReload( path );
		auto loaded = lib.Current( &r1 );
		CHECK( r1 != r0 );
		CHECK( loaded->slices.size() == 3 );

		// A broken write keeps the last good data
		{
			std::ofstream( path ) << "{\"slices\": [ broken";
		}
		lib.ForceReload( path );
		auto kept = lib.Current( &r2 );
		CHECK( r2 == r1 );
		CHECK( kept->slices.size() == 3 );
		std::remove( path );
	}

	if( failures == 0 )
		std::printf( "All core tests passed\n" );
	return failures == 0 ? 0 : 1;
}
